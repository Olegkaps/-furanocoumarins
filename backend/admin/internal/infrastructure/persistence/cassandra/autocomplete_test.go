package cassandra

import (
	"admin/internal/chemistry"
	"context"
	"database/sql"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func expectAutocompleteVersion(mock sqlmock.Sqlmock, key string) {
	mock.ExpectQuery("SELECT table_data,table_meta.*WHERE is_active").WillReturnRows(sqlmock.NewRows([]string{"data", "meta", "key"}).AddRow("chemdb.data", "chemdb.meta", key))
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
	expectAutocompleteVersion(mock, "dataset1:0")
	require.NoError(t, s.prepareAutocomplete(context.Background(), nil))
	expectAutocompleteVersion(mock, "dataset1:0")
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
		expectAutocompleteVersion(mock, key)
		require.NoError(t, s.prepareAutocomplete(context.Background(), nil))
		expectAutocompleteVersion(mock, key)
		expectAutocompleteVersion(mock, key)
		got, err = s.Autocomplete(context.Background(), "photosensitizing", nil, 20)
		require.NoError(t, err)
		require.Empty(t, got)
	}
	require.NoError(t, mock.ExpectationsWereMet())
	require.NoError(t, s.autocompleteIndex.Close())
}
func TestAutocompleteFailsClosedWhenActiveChangesOrDisappears(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	s := NewPostgresStore(db)
	expectAutocompleteVersion(mock, "dataset1")
	expectAutocompleteBuild(mock, "ref1", "title={Coumarins}")
	expectAutocompleteVersion(mock, "dataset1")
	expectAutocompleteVersion(mock, "dataset1")
	require.NoError(t, s.prepareAutocomplete(context.Background(), nil))
	expectAutocompleteVersion(mock, "dataset1")
	expectAutocompleteVersion(mock, "dataset2")
	got, err := s.Autocomplete(context.Background(), "coumarins", nil, 20)
	require.ErrorContains(t, err, "changed")
	require.Nil(t, got)
	mock.ExpectQuery("SELECT table_data,table_meta").WillReturnError(sql.ErrNoRows)
	got, err = s.Autocomplete(context.Background(), "coumarins", nil, 20)
	require.ErrorIs(t, err, sql.ErrNoRows)
	require.Nil(t, got)
	require.NoError(t, mock.ExpectationsWereMet())
	require.NoError(t, s.autocompleteIndex.Close())
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
	t.Cleanup(func() { require.NoError(t, s.CloseAutocomplete()) })
	expectAutocompleteVersion(mock, "aliases")
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT "column",show_name,type`).WillReturnRows(sqlmock.NewRows([]string{"column", "show_name", "type"}).AddRow("names", "Names", "search chemical"))
	mock.ExpectQuery(`SELECT article_id,bibtex_text`).WillReturnRows(sqlmock.NewRows([]string{"id", "text"}))
	mock.ExpectQuery(`SELECT DISTINCT member.value`).WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow("Umbelliferone=Skimmetine").AddRow("Skimmetine=Hydrangine").AddRow("Byakangelicin=5-O-Methyl heraclenol, (+),2''R"))
	mock.ExpectCommit()
	expectAutocompleteVersion(mock, "aliases")
	expectAutocompleteVersion(mock, "aliases")
	require.NoError(t, s.prepareAutocomplete(context.Background(), nil))
	for _, tc := range []struct{ query, value string }{{"SKIMMETNE", "Skimmetine"}, {"heraclenol", "5-O-Methyl heraclenol, (+),2''R"}} {
		expectAutocompleteVersion(mock, "aliases")
		expectAutocompleteVersion(mock, "aliases")
		got, err := s.Autocomplete(context.Background(), tc.query, []string{"names"}, 20)
		require.NoError(t, err)
		require.Len(t, got, 1)
		require.Equal(t, tc.value, got[0].Value)
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

func awaitAutocompleteBuild(t *testing.T, s *Store) {
	t.Helper()
	s.autocompleteMu.RLock()
	done := s.autocompleteDone
	s.autocompleteMu.RUnlock()
	if done != nil {
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("autocomplete build did not complete")
		}
	}
}

func TestAutocompleteColdBuildSurvivesRequestCancellationAndRetriesFailure(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	s := NewPostgresStore(db)
	t.Cleanup(func() { require.NoError(t, s.CloseAutocomplete()) })
	// A build error is independent of scientific readiness and the next request
	// retries; request cancellation never cancels the detached rebuild.
	expectAutocompleteVersion(mock, "dataset1")
	mock.ExpectQuery("SELECT table_data,table_meta").WillReturnError(errors.New("temporary database error"))
	_, err = s.Autocomplete(context.Background(), "coumarins", nil, 20)
	require.ErrorIs(t, err, chemistry.ErrBusy)
	awaitAutocompleteBuild(t, s)
	expectAutocompleteVersion(mock, "dataset1")
	mock.ExpectQuery("SELECT table_data,table_meta").WillDelayFor(40 * time.Millisecond).WillReturnRows(sqlmock.NewRows([]string{"data", "meta", "key"}).AddRow("chemdb.data", "chemdb.meta", "dataset1"))
	expectAutocompleteBuild(mock, "ref1", "title={Coumarins}")
	expectAutocompleteVersion(mock, "dataset1")
	expectAutocompleteVersion(mock, "dataset1")
	ctx, cancel := context.WithCancel(context.Background())
	_, err = s.Autocomplete(ctx, "coumarins", nil, 20)
	require.ErrorIs(t, err, chemistry.ErrBusy)
	cancel()
	awaitAutocompleteBuild(t, s)
	expectAutocompleteVersion(mock, "dataset1")
	expectAutocompleteVersion(mock, "dataset1")
	got, err := s.Autocomplete(context.Background(), "coumarins", nil, 20)
	require.NoError(t, err)
	require.Len(t, got, 1)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestAutocompleteReadinessFailureDoesNotBuild(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	s := NewPostgresStore(db)
	mock.ExpectExec("UPDATE chemdb.tables SET is_ok=true").WillReturnError(errors.New("failed readiness"))
	require.Error(t, (&postgresImporter{store: s}).SetTableOk(&Table{Timestamp: time.Now()}))
	require.Nil(t, s.autocompleteDone)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestAutocompleteSuccessfulImportPreparesInactiveAndActivationReusesIt(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	s := NewPostgresStore(db)
	t.Cleanup(func() { require.NoError(t, s.CloseAutocomplete()) })
	expectAutocompleteVersion(mock, "active")
	expectAutocompleteBuild(mock, "old", "title={Old coumarins}")
	expectAutocompleteVersion(mock, "active")
	expectAutocompleteVersion(mock, "active")
	require.NoError(t, s.prepareAutocomplete(context.Background(), nil))
	stamp := time.Now()
	expectTarget := func() {
		mock.ExpectQuery("SELECT table_data,table_meta.*WHERE created_at").WithArgs(stamp).WillReturnRows(sqlmock.NewRows([]string{"data", "meta", "key"}).AddRow("chemdb.data", "chemdb.meta", "new"))
	}
	mock.ExpectExec("UPDATE chemdb.tables SET is_ok=true").WithArgs(stamp).WillReturnResult(sqlmock.NewResult(0, 1))
	expectTarget()
	expectAutocompleteBuild(mock, "new", "title={New coumarins}")
	expectTarget()
	expectAutocompleteVersion(mock, "active")
	require.NoError(t, (&postgresImporter{store: s}).SetTableOk(&Table{Timestamp: stamp}))
	awaitAutocompleteBuild(t, s)
	// Import did not activate its dataset or replace the current public cache.
	expectAutocompleteVersion(mock, "active")
	expectAutocompleteVersion(mock, "active")
	got, err := s.Autocomplete(context.Background(), "coumarins", nil, 20)
	require.NoError(t, err)
	require.Equal(t, "old", got[0].Value)
	// Activating an already prepared identity needs no scientific-row scan.
	expectAutocompleteVersion(mock, "new")
	expectAutocompleteVersion(mock, "new")
	expectAutocompleteVersion(mock, "new")
	s.WarmAutocomplete()
	awaitAutocompleteBuild(t, s)
	expectAutocompleteVersion(mock, "new")
	expectAutocompleteVersion(mock, "new")
	got, err = s.Autocomplete(context.Background(), "coumarins", nil, 20)
	require.NoError(t, err)
	require.Equal(t, "new", got[0].Value)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestAutocompleteCloseCancelsBuildAndDoesNotRestart(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	s := NewPostgresStore(db)
	mock.ExpectQuery("SELECT table_data,table_meta").WillDelayFor(time.Second).WillReturnRows(sqlmock.NewRows([]string{"data", "meta", "key"}))
	s.WarmAutocomplete()
	require.Eventually(t, func() bool { return mock.ExpectationsWereMet() == nil }, time.Second, time.Millisecond)
	start := time.Now()
	require.NoError(t, s.CloseAutocomplete())
	require.Less(t, time.Since(start), 500*time.Millisecond)
	s.WarmAutocomplete()
	require.Nil(t, s.autocompleteDone)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestAutocompleteWarmSearchContinuesDuringInactiveBuild(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	s := NewPostgresStore(db)
	t.Cleanup(func() { require.NoError(t, s.CloseAutocomplete()) })
	expectAutocompleteVersion(mock, "active")
	expectAutocompleteBuild(mock, "old", "title={Old coumarins}")
	expectAutocompleteVersion(mock, "active")
	expectAutocompleteVersion(mock, "active")
	require.NoError(t, s.prepareAutocomplete(context.Background(), nil))
	mock.MatchExpectationsInOrder(false)
	stamp := time.Now()
	for range 2 {
		mock.ExpectQuery("SELECT table_data,table_meta.*WHERE created_at").WithArgs(stamp).WillReturnRows(sqlmock.NewRows([]string{"data", "meta", "key"}).AddRow("chemdb.data", "chemdb.meta", "prepared"))
	}
	mock.ExpectBegin().WillDelayFor(100 * time.Millisecond)
	mock.ExpectQuery(`SELECT "column",show_name,type`).WillReturnRows(sqlmock.NewRows([]string{"column", "show_name", "type"}).AddRow("reference", "Publication", "ref[]"))
	mock.ExpectQuery(`SELECT article_id,bibtex_text`).WillReturnRows(sqlmock.NewRows([]string{"id", "text"}).AddRow("new", "title={New coumarins}"))
	mock.ExpectQuery(`SELECT DISTINCT member.value`).WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow("new"))
	mock.ExpectCommit()
	for range 3 {
		expectAutocompleteVersion(mock, "active")
	}
	s.scheduleAutocomplete(&stamp)
	// Let the worker enter its delayed transaction, then exercise the warm cache.
	require.Eventually(t, func() bool { return db.Stats().InUse > 0 }, time.Second, time.Millisecond)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	got, err := s.Autocomplete(ctx, "coumarins", nil, 20)
	require.NoError(t, err)
	require.Equal(t, "old", got[0].Value)
	awaitAutocompleteBuild(t, s)
	require.NoError(t, mock.ExpectationsWereMet())
}
