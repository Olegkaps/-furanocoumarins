package cassandra

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	domainsearch "admin/internal/domain/search"
	"admin/internal/presentation/http/response"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEntityCountColumnsUseDatasetPinnedMetadata(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	version := int64(7)
	document := `{"schema_version":2,"importable":true,"sheets":[{"name":"main","source_sheets":["Observations"],"columns":[{"name":"species_id","data_type":"text","external_sheet":"classification"},{"name":"chemical_id","data_type":"text","external_sheet":"structures"}]},{"name":"classification","source_sheets":["Species"],"columns":[{"name":"species_id","data_type":"text","primary_key":true},{"name":"species_name","data_type":"text"}],"count_column":"species_name"},{"name":"structures","source_sheets":["Structures"],"columns":[{"name":"chemical_id","data_type":"text","primary_key":true},{"name":"canonical_name","data_type":"text"}],"count_column":"canonical_name"}]}`
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT document FROM chemdb.metadata_versions WHERE version=$1`)).
		WithArgs(version).
		WillReturnRows(sqlmock.NewRows([]string{"document"}).AddRow(document))

	keys, err := NewPostgresStore(db).EntityCountColumns(context.Background(), &Table{MetadataVersion: &version})
	require.NoError(t, err)
	require.Equal(t, map[string]string{"species": "species_name", "chemical": "canonical_name"}, keys)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSearchReaderRejectsActivationBetweenMetadataAndRows(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	old := domainsearch.TableVersion{Timestamp: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), Version: "v1", TableData: "chemdb.old"}
	newer := old
	newer.Timestamp = newer.Timestamp.Add(time.Second)
	newer.Version, newer.TableData = "v2", "chemdb.new"
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT created_at,name,version,table_meta,table_data,table_species,is_ok,is_active,metadata_version FROM chemdb.tables WHERE is_active AND is_ok`)).
		WillReturnRows(sqlmock.NewRows([]string{"created_at", "name", "version", "table_meta", "table_data", "table_species", "is_ok", "is_active", "metadata_version"}).
			AddRow(newer.Timestamp, "new", newer.Version, "chemdb.meta_new", newer.TableData, "chemdb.species_new", true, true, nil))

	_, err = NewSearchReader(NewPostgresStore(db)).FetchSearchData(nil, old, "name = 'old'", "name")
	require.ErrorContains(t, err, "active dataset changed")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestWithImageLibraryLockCommitsAfterMutation(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectExec(`SELECT pg_advisory_xact_lock\(\$1\)`).WithArgs(imageLibraryLock).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	called := false
	err = NewPostgresStore(db).WithImageLibraryLock(context.Background(), func() error {
		called = true
		return nil
	})
	require.NoError(t, err)
	require.True(t, called)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPostgresPrefixFailures(t *testing.T) {
	for _, tc := range []struct {
		name      string
		column    string
		lookupErr error
		queryErr  error
		userError bool
	}{
		{name: "unsafe column", column: "name;DROP", userError: true},
		{name: "unknown column", column: "missing", lookupErr: sql.ErrNoRows, userError: true},
		{name: "schema lookup failure", column: "name", lookupErr: assert.AnError},
		{name: "query failure", column: "name", queryErr: assert.AnError},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			defer db.Close()
			if tc.column != "name;DROP" {
				q := mock.ExpectQuery("SELECT atttypid").WithArgs(`"chemdb"."data"`, tc.column)
				if tc.lookupErr != nil {
					q.WillReturnError(tc.lookupErr)
				} else {
					q.WillReturnRows(sqlmock.NewRows([]string{"array"}).AddRow(false))
					mock.ExpectQuery("SELECT DISTINCT").WithArgs(`a\%\_\\'%`).WillReturnError(tc.queryErr)
				}
			}
			_, err = NewPostgresStore(db).pgGetPrefix("chemdb.data", tc.column, `a%_\'`)
			require.Error(t, err)
			if tc.userError {
				var userErr *response.UserError
				require.ErrorAs(t, err, &userErr)
			} else {
				require.ErrorIs(t, err, assert.AnError)
			}
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestPostgresWhereBindsValuesAndQuotesColumns(t *testing.T) {
	where, args, err := pgWhere("species LIKE 'Angelica%' AND name = 'O''Brien `complex`'")
	require.NoError(t, err)
	assert.Equal(t, `"species" ILIKE $1 AND "name" = $2`, where)
	assert.Equal(t, []any{"Angelica%", "O'Brien `complex`"}, args)
	assert.NotContains(t, where, "Angelica")
	assert.NotContains(t, where, "Brien")
	assert.NotContains(t, where, "`complex`")
}

func TestPostgresWhereRejectsSQLInjection(t *testing.T) {
	_, _, err := pgWhere("species = 'x' OR 1=1")
	require.Error(t, err)
}

func TestPostgresWhereBooleanPrecedence(t *testing.T) {
	for _, tc := range []struct{ raw, sql string }{
		{"a='1' OR b='2' AND c='3'", `"a" = $1 OR ("b" = $2 AND "c" = $3)`},
		{"(a='1' OR b='2') AND c='3'", `("a" = $1 OR "b" = $2) AND "c" = $3`},
		{"a='1' AND (b='2' OR (c='3'))", `"a" = $1 AND ("b" = $2 OR "c" = $3)`},
	} {
		t.Run(tc.raw, func(t *testing.T) {
			where, args, err := pgWhere(tc.raw)
			require.NoError(t, err)
			assert.Equal(t, tc.sql, where)
			assert.Equal(t, []any{"1", "2", "3"}, args)
		})
	}
}

func TestPostgresWhereGroupedValuesRemainParameters(t *testing.T) {
	where, args, err := pgWhere("(aliases CONTAINS 'O''Brien `OR` (AND)' OR species LIKE '%''; DROP TABLE users; --') AND name != ''")
	require.NoError(t, err)
	assert.Equal(t, `("aliases" @> ARRAY[$1]::text[] OR "species" ILIKE $2) AND "name" != $3`, where)
	assert.Equal(t, []any{"O'Brien `OR` (AND)", "%'; DROP TABLE users; --", ""}, args)
}

func TestPostgresWhereScalarOperators(t *testing.T) {
	for _, op := range []string{"=", "!=", "<", ">", "<=", ">="} {
		where, args, err := pgWhere("name " + op + " 'value'")
		require.NoError(t, err)
		assert.Equal(t, `"name" `+op+` $1`, where)
		assert.Equal(t, []any{"value"}, args)
	}
}

func TestPostgresWhereLikeUsesCaseInsensitivePostgresOperator(t *testing.T) {
	where, args, err := pgWhere("species LIKE 'aNgElIcA%'")
	require.NoError(t, err)
	assert.Equal(t, `"species" ILIKE $1`, where)
	assert.Equal(t, []any{"aNgElIcA%"}, args)
}

func TestPostgresWhereRejectsUnsupportedIN(t *testing.T) {
	_, _, err := pgWhere("species IN ('Angelica')")
	require.Error(t, err)
}

func TestPostgresContainsPreservesQuotedConjunctions(t *testing.T) {
	where, args, err := pgWhere("aliases CONTAINS 'O''Brien AND sons' AND species LIKE 'a AND b%'")
	require.NoError(t, err)
	assert.Equal(t, `"aliases" @> ARRAY[$1]::text[] AND "species" ILIKE $2`, where)
	assert.Equal(t, []any{"O'Brien AND sons", "a AND b%"}, args)
	for _, malformed := range []string{"", "aliases CONTAINS 'a' AND", "aliases CONTAINS 'a' AND ", "aliases CONTAINS 'a'b'", "aliases CONTAINS 'a' OR species ="} {
		_, _, err := pgWhere(malformed)
		require.Error(t, err, malformed)
	}
}

func TestPostgresSetValuesUseDriverArray(t *testing.T) {
	for _, value := range []any{[]string{"a"}, map[string]struct{}{"a": {}}} {
		array, err := postgresSetArray(value)
		require.NoError(t, err)
		assert.NotNil(t, array)
	}
	_, err := postgresSetArray("not-a-collection")
	require.Error(t, err)
}

func TestPostgresIdentifierRejectsSchemaInjection(t *testing.T) {
	_, err := pgTable(`chemdb.data;DROP TABLE users`)
	require.Error(t, err)
}
