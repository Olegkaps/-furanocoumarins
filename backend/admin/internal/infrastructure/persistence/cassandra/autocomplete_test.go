package cassandra

import (
	"context"
	"database/sql"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
	"testing"
)

func expectAutocompleteVersion(mock sqlmock.Sqlmock, key string) {
	mock.ExpectQuery("SELECT table_data,table_meta").WillReturnRows(sqlmock.NewRows([]string{"data", "meta", "key"}).AddRow("chemdb.data", "chemdb.meta", key))
}
func expectAutocompleteBuild(mock sqlmock.Sqlmock, value, bib string) {
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT "column",show_name,type`).WillReturnRows(sqlmock.NewRows([]string{"column", "show_name", "type"}).AddRow("reference", "Publication", "ref[]"))
	mock.ExpectQuery(`SELECT article_id,bibtex_text`).WillReturnRows(sqlmock.NewRows([]string{"id", "text"}).AddRow(value, bib))
	mock.ExpectQuery(`SELECT DISTINCT member.value`).WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(value))
	mock.ExpectCommit()
}
func TestAutocompleteRebuildsOnDatasetOrBibliographyGeneration(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	s := NewPostgresStore(db)
	expectAutocompleteVersion(mock, "dataset1:0")
	expectAutocompleteBuild(mock, "ref1", "title={Photosensitizing coumarins}")
	expectAutocompleteVersion(mock, "dataset1:0")
	got, err := s.Autocomplete(context.Background(), "photosensitizing", nil, 20)
	require.NoError(t, err)
	require.Len(t, got, 1)
	require.Equal(t, "ref1", got[0].Value)
	require.Equal(t, "Publication", got[0].ShowName)
	// An unchanged generation reuses the index without loading scientific rows.
	expectAutocompleteVersion(mock, "dataset1:0")
	expectAutocompleteVersion(mock, "dataset1:0")
	got, err = s.Autocomplete(context.Background(), "COUMARINS", nil, 20)
	require.NoError(t, err)
	require.Len(t, got, 1)
	for _, key := range []string{"dataset1:1", "dataset2:1"} {
		expectAutocompleteVersion(mock, key)
		expectAutocompleteBuild(mock, "ref2", "title={New bibliography}")
		expectAutocompleteVersion(mock, key)
		got, err = s.Autocomplete(context.Background(), "photosensitizing", nil, 20)
		require.NoError(t, err)
		require.Empty(t, got)
	}
	require.NoError(t, mock.ExpectationsWereMet())
	s.autocompleteIndex.Close()
}
func TestAutocompleteFailsClosedWhenActiveChangesOrDisappears(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	s := NewPostgresStore(db)
	expectAutocompleteVersion(mock, "dataset1")
	expectAutocompleteBuild(mock, "ref1", "title={Coumarins}")
	expectAutocompleteVersion(mock, "dataset2")
	got, err := s.Autocomplete(context.Background(), "coumarins", nil, 20)
	require.ErrorContains(t, err, "changed")
	require.Nil(t, got)
	mock.ExpectQuery("SELECT table_data,table_meta").WillReturnError(sql.ErrNoRows)
	got, err = s.Autocomplete(context.Background(), "coumarins", nil, 20)
	require.ErrorIs(t, err, sql.ErrNoRows)
	require.Nil(t, got)
	require.NoError(t, mock.ExpectationsWereMet())
	s.autocompleteIndex.Close()
}
func TestBibtexSearchText(t *testing.T) {
	require.Equal(t, "The Psoralen study Müller and Smith 2026", bibtexSearchText("@article{ref,\ntitle={The {Psoralen} study},\nauthor={Müller and Smith},\nyear=2026}"))
}
func TestBibtexNestedFieldsAccentsAndConcatenation(t *testing.T) {
	text := `@article{ref, title={A {nested, title=fake} value}, author="M{\"u}ller and Garc{\'i}a", year=2026, journal="Photo" # "chemistry"}`
	require.Equal(t, "A nested, title=fake value Müller and García 2026 Photo chemistry", bibtexSearchText(text))
}

func TestChemicalAliasesAutocompleteAreDistinctMembers(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	s := NewPostgresStore(db)
	defer s.CloseAutocomplete()
	expectAutocompleteVersion(mock, "aliases")
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT "column",show_name,type`).WillReturnRows(sqlmock.NewRows([]string{"column", "show_name", "type"}).AddRow("names", "Names", "search chemical"))
	mock.ExpectQuery(`SELECT article_id,bibtex_text`).WillReturnRows(sqlmock.NewRows([]string{"id", "text"}))
	mock.ExpectQuery(`SELECT DISTINCT member.value`).WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow("Umbelliferone=Skimmetine").AddRow("Skimmetine=Hydrangine").AddRow("Byakangelicin=5-O-Methyl heraclenol, (+),2''R"))
	mock.ExpectCommit()
	for _, tc := range []struct{ query, value string }{{"SKIMMETNE", "Skimmetine"}, {"heraclenol", "5-O-Methyl heraclenol, (+),2''R"}} {
		if tc.query != "SKIMMETNE" {
			expectAutocompleteVersion(mock, "aliases")
		}
		expectAutocompleteVersion(mock, "aliases")
		got, err := s.Autocomplete(context.Background(), tc.query, []string{"names"}, 20)
		require.NoError(t, err)
		require.Len(t, got, 1)
		require.Equal(t, tc.value, got[0].Value)
	}
	require.NoError(t, mock.ExpectationsWereMet())
}
