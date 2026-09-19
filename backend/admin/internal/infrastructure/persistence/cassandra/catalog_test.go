package cassandra

import (
	"context"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestSourceCatalogSeeksUnjoinedRowsByPrimaryKey(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	store := NewPostgresStore(db)
	table := &Table{TableData: "chemdb.data_fixture", TableSpecies: "chemdb.species_fixture"}
	physical := SourceTableName(table.TableData, "structures")

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT to_regclass($1) IS NOT NULL`)).
		WithArgs(`"chemdb"."data_fixture_sources"`).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT physical_table,entity_kind,primary_column,columns_json FROM "chemdb"."data_fixture_sources" WHERE virtual_name=$1`)).
		WithArgs("structures").
		WillReturnRows(sqlmock.NewRows([]string{"physical_table", "entity_kind", "primary_column", "columns_json"}).
			AddRow(physical, "chemicals", "chemical_id", `[["structures","chemical_id","primary","Identifier","ID"],["structures","name","text","","Chemical"]]`))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT row_to_json(source_row)::text FROM (SELECT * FROM `+mustPGTable(t, physical)+` WHERE "chemical_id" > $1 ORDER BY "chemical_id" LIMIT $2) source_row`)).
		WithArgs("unjoined-1", 2).
		WillReturnRows(sqlmock.NewRows([]string{"row"}).
			AddRow(`{"chemical_id":"unjoined-2","name":"Source only"}`).
			AddRow(`{"chemical_id":"unjoined-3","name":"Later source"}`))

	page, err := store.pgSourceCatalog(context.Background(), table, "chemicals", "unjoined-1", "", 1)
	require.NoError(t, err)
	require.Equal(t, "Source only", page.Items[0]["name"])
	require.Equal(t, "dW5qb2luZWQtMg", page.PreviousCursor)
	require.Equal(t, "dW5qb2luZWQtMg", page.NextCursor)
	require.Equal(t, "Chemical", page.Columns[1].Name)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCatalogPageUsesExtraRowToBuildReverseCursor(t *testing.T) {
	page := catalogPage("chemicals", 2, "", "chemical-5", "chemical_id", []map[string]any{
		{"chemical_id": "chemical-2"},
		{"chemical_id": "chemical-3"},
		{"chemical_id": "chemical-4"},
	})
	require.Equal(t, []map[string]any{{"chemical_id": "chemical-3"}, {"chemical_id": "chemical-4"}}, page.Items)
	require.Equal(t, "Y2hlbWljYWwtMw", page.PreviousCursor)
	require.Equal(t, "Y2hlbWljYWwtNA", page.NextCursor)
}

func TestSourceCatalogSeeksBackwardByPrimaryKey(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	store := NewPostgresStore(db)
	table := &Table{TableData: "chemdb.data_fixture", TableSpecies: "chemdb.species_fixture"}
	physical := SourceTableName(table.TableData, "structures")

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT to_regclass($1) IS NOT NULL`)).
		WithArgs(`"chemdb"."data_fixture_sources"`).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT physical_table,entity_kind,primary_column,columns_json FROM "chemdb"."data_fixture_sources" WHERE virtual_name=$1`)).
		WithArgs("structures").
		WillReturnRows(sqlmock.NewRows([]string{"physical_table", "entity_kind", "primary_column", "columns_json"}).
			AddRow(physical, "chemicals", "chemical_id", `[["structures","chemical_id","primary","Identifier","ID"]]`))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT row_to_json(source_row)::text FROM (SELECT * FROM `+mustPGTable(t, physical)+` WHERE "chemical_id" < $1 ORDER BY "chemical_id" DESC LIMIT $2) source_row ORDER BY "chemical_id" ASC`)).
		WithArgs("chemical-5", 3).
		WillReturnRows(sqlmock.NewRows([]string{"row"}).
			AddRow(`{"chemical_id":"chemical-2"}`).
			AddRow(`{"chemical_id":"chemical-3"}`).
			AddRow(`{"chemical_id":"chemical-4"}`))

	page, err := store.pgSourceCatalog(context.Background(), table, "chemicals", "", "chemical-5", 2)
	require.NoError(t, err)
	require.Equal(t, []map[string]any{{"chemical_id": "chemical-3"}, {"chemical_id": "chemical-4"}}, page.Items)
	require.Equal(t, "Y2hlbWljYWwtMw", page.PreviousCursor)
	require.Equal(t, "Y2hlbWljYWwtNA", page.NextCursor)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCatalogCursorIsOpaqueAndRoundTripsPrimaryKey(t *testing.T) {
	cursor := catalogCursor(map[string]any{"chemical_id": "source key / 42"}, "chemical_id")
	value, err := decodeCatalogCursor(cursor)
	require.NoError(t, err)
	require.Equal(t, "source key / 42", value)
	_, err = decodeCatalogCursor("not a cursor")
	require.Error(t, err)
}

func TestCatalogCountIsSeparateFromCursorPageQuery(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT COUNT(*) FROM "chemdb"."data_fixture_structures"`)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(49))
	count, err := NewPostgresStore(db).pgCatalogCount(context.Background(), "chemicals", `"chemdb"."data_fixture_structures"`, 24)
	require.NoError(t, err)
	require.EqualValues(t, 49, count.Total)
	require.EqualValues(t, 3, count.PageCount)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCatalogCountHasNoPagesForAnEmptyCatalog(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT COUNT(*) FROM chemdb.bibtex`)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	count, err := NewPostgresStore(db).pgCatalogCount(context.Background(), "publications", "chemdb.bibtex", 24)
	require.NoError(t, err)
	require.Zero(t, count.PageCount)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSourceCatalogIsExplicitlyUnavailableForLegacyDataset(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT to_regclass($1) IS NOT NULL`)).
		WithArgs(`"chemdb"."data_fixture_sources"`).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	_, err = NewPostgresStore(db).pgSourceCatalog(context.Background(), &Table{TableData: "chemdb.data_fixture"}, "chemicals", "", "", 24)
	require.ErrorIs(t, err, ErrCatalogUnavailable)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSourceCatalogRecordUsesOnlyDeclaredColumns(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	store := NewPostgresStore(db)
	table := &Table{TableData: "chemdb.data_fixture", TableSpecies: "chemdb.species_fixture"}
	physical := SourceTableName(table.TableData, "structures")

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT to_regclass($1) IS NOT NULL`)).
		WithArgs(`"chemdb"."data_fixture_sources"`).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT physical_table,entity_kind,primary_column,columns_json FROM "chemdb"."data_fixture_sources" WHERE virtual_name=$1`)).
		WithArgs("structures").
		WillReturnRows(sqlmock.NewRows([]string{"physical_table", "entity_kind", "primary_column", "columns_json"}).
			AddRow(physical, "chemicals", "chemical_id", `[["structures","chemical_id","primary","Identifier","ID"],["structures","smiles","SMILES chemical_page","","SMILES"]]`))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT row_to_json(source_row)::text FROM (SELECT * FROM ` + mustPGTable(t, physical) + ` WHERE "smiles"=$1 LIMIT 1) source_row`)).
		WithArgs("CCO").
		WillReturnRows(sqlmock.NewRows([]string{"row"}).AddRow(`{"chemical_id":"unjoined-2","smiles":"CCO"}`))

	record, err := store.pgSourceCatalogRecord(context.Background(), table, "chemicals", "smiles", "CCO")
	require.NoError(t, err)
	require.Equal(t, "unjoined-2", record.Item["chemical_id"])
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPublicationCatalogSeeksByArticleID(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT row_to_json(source_row)::text FROM (SELECT * FROM chemdb.bibtex WHERE article_id > $1 ORDER BY article_id LIMIT $2) source_row`)).
		WithArgs("paper-1", 2).WillReturnRows(sqlmock.NewRows([]string{"row"}).AddRow(`{"article_id":"paper-2","bibtex_text":"@article{paper-2}"}`))
	page, err := NewPostgresStore(db).pgPublicationCatalog(context.Background(), "paper-1", "", 1)
	require.NoError(t, err)
	require.Equal(t, "paper-2", page.Items[0]["article_id"])
	require.Equal(t, "cGFwZXItMg", page.PreviousCursor)
	require.Empty(t, page.NextCursor)
	require.NoError(t, mock.ExpectationsWereMet())
}

func mustPGTable(t *testing.T, name string) string {
	t.Helper()
	quoted, err := pgTable(name)
	require.NoError(t, err)
	return quoted
}
