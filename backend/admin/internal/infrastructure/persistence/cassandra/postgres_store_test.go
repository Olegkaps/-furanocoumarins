package cassandra

import (
	"database/sql"
	"testing"

	"admin/internal/presentation/http/response"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
