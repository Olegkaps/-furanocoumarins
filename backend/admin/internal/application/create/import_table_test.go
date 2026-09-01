package create_test

import (
	"errors"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"
	"strings"
	"testing"

	appcreate "admin/internal/application/create"
	"admin/internal/infrastructure/logging"
	"admin/internal/infrastructure/persistence/cassandra"
)

type mockImporter struct {
	insertErr      error
	batchErr       error
	batchErrOn     int
	batchCalls     int
	setOkErr       error
	sasiErr        error
	articleIDs     map[string]string
	getArticleErr  error
	lastBatchCols  []string
	lastBatchTable string
	insertCalls    int
	setOkCalls     int
	panicArticle   bool
	calls          []string
}

func (m *mockImporter) ReserveTable(_ *cassandra.Table) (bool, error) {
	m.insertCalls++
	m.calls = append(m.calls, "reserve")
	return m.insertErr == nil, m.insertErr
}

func (m *mockImporter) CreateAndBatchInsert(tableName string, columnDefs, primaryKeys []string, data [][]any) error {
	m.batchCalls++
	m.calls = append(m.calls, "batch")
	m.lastBatchTable = tableName
	m.lastBatchCols = columnDefs
	if m.batchErr != nil && m.batchCalls == m.batchErrOn {
		return m.batchErr
	}
	return nil
}

func (m *mockImporter) SetTableOk(_ *cassandra.Table) error {
	m.setOkCalls++
	m.calls = append(m.calls, "set_ok")
	return m.setOkErr
}

func (m *mockImporter) GetArticleIds() (map[string]string, error) {
	m.calls = append(m.calls, "article_ids")
	if m.panicArticle {
		panic("article lookup panic")
	}
	if m.getArticleErr != nil {
		return nil, m.getArticleErr
	}
	if m.articleIDs != nil {
		return m.articleIDs, nil
	}
	return map[string]string{}, nil
}

func (m *mockImporter) CreateSASIIndex(string, string) error {
	m.calls = append(m.calls, "sasi")
	return m.sasiErr
}

type mockStore struct {
	imp cassandra.TableImporter
	err error
}

func (s *mockStore) WithImporter(fn func(cassandra.TableImporter) error) error {
	if s.err != nil {
		return s.err
	}
	return fn(s.imp)
}

func setMetaRows(t *testing.T, f *excelize.File, rows [][]any) {
	t.Helper()
	require.NoError(t, f.SetSheetName("Sheet1", "meta"))
	for i, row := range rows {
		cell, _ := excelize.CoordinatesToCellName(1, i+1)
		require.NoError(t, f.SetSheetRow("meta", cell, &row))
	}
}

func metaWorkbook(t *testing.T) *excelize.File {
	t.Helper()
	f := excelize.NewFile()
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"__LIST__", "main", "main", "", ""},
		{"__LIST__", "classification", "classification", "", ""},
		{"main", "id", "primary", "", "ID"},
		{"classification", "id", "primary", "", "ID"},
	})
	return f
}

func fullImportWorkbook(t *testing.T) *excelize.File {
	t.Helper()
	f := excelize.NewFile()
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"__LIST__", "main", "main", "", ""},
		{"__LIST__", "classification", "classification", "", ""},
		{"main", "id", "primary", "", "ID"},
		{"main", "name", "text", "", "Name"},
		{"classification", "cid", "primary", "", "CID"},
		{"classification", "species", "text", "", "Species"},
	})

	_, err := f.NewSheet("main")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("main", "A1", &[]any{"id", "name"}))
	require.NoError(t, f.SetSheetRow("main", "A2", &[]any{"1", "chem"}))

	_, err = f.NewSheet("classification")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("classification", "A1", &[]any{"cid", "species"}))
	require.NoError(t, f.SetSheetRow("classification", "A2", &[]any{"1", "sp1"}))
	return f
}

func refImportWorkbook(t *testing.T) *excelize.File {
	t.Helper()
	f := fullImportWorkbook(t)
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"__LIST__", "main", "main", "", ""},
		{"__LIST__", "classification", "classification", "", ""},
		{"main", "id", "primary", "", "ID"},
		{"main", "name", "text", "", "Name"},
		{"main", "ref", "ref[]", "", "Ref"},
		{"classification", "cid", "primary", "", "CID"},
		{"classification", "species", "text", "", "Species"},
	})
	require.NoError(t, f.SetSheetRow("main", "A1", &[]any{"id", "name", "ref"}))
	require.NoError(t, f.SetSheetRow("main", "A2", &[]any{"1", "chem", "art1"}))
	return f
}

func TestImportTableNegativeStoreNotConfigured(t *testing.T) {
	store := cassandra.NewStore(nil)
	f := metaWorkbook(t)

	_, err := appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.ErrorIs(t, err, cassandra.ErrNotConfigured)
}

func TestImportTableNegativeInsertFails(t *testing.T) {
	store := &mockStore{imp: &mockImporter{insertErr: errors.New("insert failed")}}
	f := fullImportWorkbook(t)

	_, err := appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "insert failed")
}

func TestImportTableNegativeMissingMetaSheet(t *testing.T) {
	store := &mockStore{imp: &mockImporter{}}
	f := excelize.NewFile()

	_, err := appcreate.ImportTable(store, f, "missing", "test-table", logging.Nop{})
	require.Error(t, err)
}

func TestImportTableNegativeUnknownSheet(t *testing.T) {
	store := &mockStore{imp: &mockImporter{}}
	f := excelize.NewFile()
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"unknown", "id", "primary", "", "ID"},
	})

	_, err := appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown sheet name")
}

func TestImportTablePositiveRefCheckSkipped(t *testing.T) {
	store := &mockStore{imp: &mockImporter{}}
	f := fullImportWorkbook(t)

	msg, err := appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.NoError(t, err)
	assert.Equal(t, "Column with type 'ref[]' not found, reference check skipped.", msg)
}

func TestImportTableNegativeConflictingColumnMeta(t *testing.T) {
	store := &mockStore{imp: &mockImporter{}}
	f := excelize.NewFile()
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"main", "id", "primary", "first", "ID"},
		{"other", "id", "text", "second", "ID"},
	})

	_, err := appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "different descriptions")
}

func TestImportTableNegativeMetaBatchInsertFails(t *testing.T) {
	store := &mockStore{imp: &mockImporter{batchErr: errors.New("meta batch"), batchErrOn: 1}}
	f := fullImportWorkbook(t)

	_, err := appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "meta batch")
}

func TestImportTableNegativeMissingClassification(t *testing.T) {
	store := &mockStore{imp: &mockImporter{}}
	f := excelize.NewFile()
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"__LIST__", "main", "main", "", ""},
		{"main", "id", "primary", "", "ID"},
	})
	_, err := f.NewSheet("main")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("main", "A1", &[]any{"id"}))
	require.NoError(t, f.SetSheetRow("main", "A2", &[]any{"1"}))

	_, err = appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing classifaction")
}

func TestImportTableNegativeMissingMain(t *testing.T) {
	store := &mockStore{imp: &mockImporter{}}
	f := excelize.NewFile()
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"__LIST__", "classification", "classification", "", ""},
		{"classification", "cid", "primary", "", "CID"},
	})
	_, err := f.NewSheet("classification")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("classification", "A1", &[]any{"cid"}))
	require.NoError(t, f.SetSheetRow("classification", "A2", &[]any{"1"}))

	_, err = appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing main sheet")
}

func TestImportTableNegativeVirtualSheetReadFails(t *testing.T) {
	store := &mockStore{imp: &mockImporter{}}
	f := excelize.NewFile()
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"__LIST__", "main", "main", "", ""},
		{"__LIST__", "classification", "classification", "", ""},
		{"main", "id", "primary", "", "ID"},
		{"classification", "cid", "primary", "", "CID"},
	})

	_, err := appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.Error(t, err)
}

func TestImportTableNegativeSpeciesBatchFails(t *testing.T) {
	store := &mockStore{imp: &mockImporter{batchErr: errors.New("species batch"), batchErrOn: 2}}
	f := fullImportWorkbook(t)

	_, err := appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "species batch")
}

func TestImportTableNegativeDataBatchFails(t *testing.T) {
	store := &mockStore{imp: &mockImporter{batchErr: errors.New("data batch"), batchErrOn: 3}}
	f := fullImportWorkbook(t)

	_, err := appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "data batch")
}

func TestImportTableNegativeExternalSheetNotFound(t *testing.T) {
	store := &mockStore{imp: &mockImporter{}}
	f := excelize.NewFile()
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"__LIST__", "main", "main", "", ""},
		{"__LIST__", "classification", "classification", "", ""},
		{"main", "id", "primary", "", "ID"},
		{"main", "cls", "external[ghost]", "", "Cls"},
		{"classification", "cid", "primary", "", "CID"},
	})
	_, err := f.NewSheet("main")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("main", "A1", &[]any{"id", "cls"}))
	require.NoError(t, f.SetSheetRow("main", "A2", &[]any{"1", "1"}))
	_, err = f.NewSheet("classification")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("classification", "A1", &[]any{"cid"}))
	require.NoError(t, f.SetSheetRow("classification", "A2", &[]any{"1"}))

	_, err = appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "external' not found")
}

func TestImportTableMalformedExternalMetadataHasNoCassandraWritesOrPanic(t *testing.T) {
	for _, malformed := range []string{"external", "external[", "external[]", "external[a][b]", "external[a] external[b]"} {
		t.Run(malformed, func(t *testing.T) {
			imp := &mockImporter{}
			store := &mockStore{imp: imp}
			f := fullImportWorkbook(t)
			setMetaRows(t, f, [][]any{
				{"sheet", "column", "type", "description", "show_name"},
				{"__LIST__", "main", "main", "", ""},
				{"__LIST__", "classification", "classification", "", ""},
				{"main", "id", "primary", "", "ID"},
				{"main", "name", malformed, "", "Name"},
				{"classification", "cid", "primary", "", "CID"},
				{"classification", "species", "text", "", "Species"},
			})
			require.NotPanics(t, func() {
				_, err := appcreate.ImportTable(store, f, "meta", "malformed", logging.Nop{})
				require.Error(t, err)
			})
			require.Zero(t, imp.insertCalls)
			require.Zero(t, imp.batchCalls)
		})
	}
}

func TestImportTableNegativeMissingPrimaryKeyInJoin(t *testing.T) {
	store := &mockStore{imp: &mockImporter{}}
	f := excelize.NewFile()
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"__LIST__", "main", "main", "", ""},
		{"__LIST__", "classification", "classification", "", ""},
		{"main", "id", "primary", "", "ID"},
		{"main", "cls", "external[classification]", "", "Cls"},
		{"classification", "cid", "primary", "", "CID"},
		{"classification", "species", "text", "", "Species"},
	})
	_, err := f.NewSheet("main")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("main", "A1", &[]any{"id", "cls"}))
	require.NoError(t, f.SetSheetRow("main", "A2", &[]any{"1", "missing"}))
	_, err = f.NewSheet("classification")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("classification", "A1", &[]any{"cid", "species"}))
	require.NoError(t, f.SetSheetRow("classification", "A2", &[]any{"1", "sp1"}))

	_, err = appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Not found primary key")
}

func TestImportTablePositiveWithSearchIndex(t *testing.T) {
	imp := &mockImporter{}
	store := &mockStore{imp: imp}
	f := fullImportWorkbook(t)
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"__LIST__", "main", "main", "", ""},
		{"__LIST__", "classification", "classification", "", ""},
		{"main", "id", "primary", "", "ID"},
		{"main", "name", "search", "", "Name"},
		{"classification", "cid", "primary", "", "CID"},
		{"classification", "species", "text", "", "Species"},
	})

	msg, err := appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.NoError(t, err)
	assert.Contains(t, msg, "reference check skipped")
	assert.Contains(t, imp.calls, "sasi")
}

func TestImportTableResearchTokenDoesNotCreateSearchIndex(t *testing.T) {
	imp := &mockImporter{}
	f := fullImportWorkbook(t)
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"__LIST__", "main", "main", "", ""},
		{"__LIST__", "classification", "classification", "", ""},
		{"main", "id", "primary", "", "ID"},
		{"main", "name", "research", "", "Name"},
		{"classification", "cid", "primary", "", "CID"},
		{"classification", "species", "text", "", "Species"},
	})

	_, err := appcreate.ImportTable(&mockStore{imp: imp}, f, "meta", "research-token", logging.Nop{})
	require.NoError(t, err)
	assert.NotContains(t, imp.calls, "sasi", "research is an ordinary metadata token, not search")
}

func TestImportTableSupportsClasLinkAndFiniteSetModifiers(t *testing.T) {
	imp := &mockImporter{}
	f := excelize.NewFile()
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"__LIST__", "main", "main", "", ""},
		{"__LIST__", "classification", "classification", "", ""},
		{"main", "id", "primary", "", "ID"},
		{"main", "classification_id", "external[classification]", "", "Classification"},
		{"main", "source_link", "link[https://example.test/articles/%s] table_", "", "Source"},
		{"main", "aliases", "set[Bergapten Psoralen] search chemical", "", "Aliases"},
		{"classification", "classification_id", "primary", "", "Classification"},
		{"classification", "family", "clas[01][gbif] table_specie", "", "Family"},
	})
	_, err := f.NewSheet("main")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("main", "A1", &[]any{"id", "classification_id", "source_link", "aliases"}))
	require.NoError(t, f.SetSheetRow("main", "A2", &[]any{"1", "class-1", "ref-real", "Bergapten Psoralen"}))
	_, err = f.NewSheet("classification")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("classification", "A1", &[]any{"classification_id", "family"}))
	require.NoError(t, f.SetSheetRow("classification", "A2", &[]any{"class-1", "Rutaceae"}))

	_, err = appcreate.ImportTable(&mockStore{imp: imp}, f, "meta", "scientific-modifiers", logging.Nop{})
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{
		"id TEXT", "classification_id TEXT", "source_link TEXT", "aliases SET<TEXT>", "family TEXT", "uuid UUID",
	}, imp.lastBatchCols)
	assert.NotContains(t, imp.calls, "sasi", "finite-choice sets must not create a SASI index")
}

func TestImportTableNearPrimaryTokenHasNoCassandraWrites(t *testing.T) {
	imp := &mockImporter{}
	f := fullImportWorkbook(t)
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"__LIST__", "main", "main", "", ""},
		{"__LIST__", "classification", "classification", "", ""},
		{"main", "id", "notprimary", "", "ID"},
		{"main", "name", "text", "", "Name"},
		{"classification", "cid", "primary", "", "CID"},
		{"classification", "species", "text", "", "Species"},
	})

	_, err := appcreate.ImportTable(&mockStore{imp: imp}, f, "meta", "not-primary", logging.Nop{})
	require.ErrorContains(t, err, "has no primary column")
	require.Zero(t, imp.insertCalls)
	require.Zero(t, imp.batchCalls)
	require.Zero(t, imp.setOkCalls)
}

func TestImportTableNegativeSASIIndexFails(t *testing.T) {
	store := &mockStore{imp: &mockImporter{sasiErr: errors.New("sasi failed")}}
	f := fullImportWorkbook(t)
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"__LIST__", "main", "main", "", ""},
		{"__LIST__", "classification", "classification", "", ""},
		{"main", "id", "primary", "", "ID"},
		{"main", "name", "search", "", "Name"},
		{"classification", "cid", "primary", "", "CID"},
		{"classification", "species", "text", "", "Species"},
	})

	_, err := appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "sasi failed")
}

func TestImportTableNegativeSetTableOkFails(t *testing.T) {
	imp := &mockImporter{setOkErr: errors.New("set ok failed")}
	store := &mockStore{imp: imp}
	f := fullImportWorkbook(t)

	_, err := appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "set ok failed")
	require.Equal(t, 1, imp.setOkCalls)
	require.Equal(t, "set_ok", imp.calls[len(imp.calls)-1])
}

func TestImportTablePositiveRefCheckPassed(t *testing.T) {
	imp := &mockImporter{articleIDs: map[string]string{"art1": "bib"}}
	store := &mockStore{imp: imp}
	f := refImportWorkbook(t)

	msg, err := appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.NoError(t, err)
	assert.Equal(t, "Reference check passed", msg)
	require.Equal(t, []string{"article_ids", "set_ok"}, imp.calls[len(imp.calls)-2:], "readiness must be the final external call")
}

func TestImportTablePositiveRefCheckFailed(t *testing.T) {
	store := &mockStore{imp: &mockImporter{articleIDs: map[string]string{}}}
	f := refImportWorkbook(t)

	msg, err := appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(msg, "Failed reference checks:"))
	assert.Contains(t, msg, "missing article id 'art1'")
}

func TestImportTableNegativeGetArticleIdsFails(t *testing.T) {
	imp := &mockImporter{getArticleErr: errors.New("articles failed")}
	store := &mockStore{imp: imp}
	f := refImportWorkbook(t)

	_, err := appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "articles failed")
	require.Zero(t, imp.setOkCalls, "late reference failures must leave the registry row Broken")
}

func TestImportTableReferenceLookupPanicCannotMarkTableReady(t *testing.T) {
	imp := &mockImporter{panicArticle: true}
	store := &mockStore{imp: imp}
	f := refImportWorkbook(t)

	require.Panics(t, func() {
		_, _ = appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	})
	require.Zero(t, imp.setOkCalls, "panic containment in the handler must observe a still-Broken table")
}

func TestImportTablePositiveDuplicateColumnMetaAllowed(t *testing.T) {
	store := &mockStore{imp: &mockImporter{}}
	f := excelize.NewFile()
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"__LIST__", "main", "main", "", ""},
		{"__LIST__", "classification", "classification", "", ""},
		{"__LIST__", "structures", "structures", "", ""},
		{"structures", "sid", "primary", "same", "SID"},
		{"main", "sid", "external[structures]", "same", "SID"},
		{"main", "id", "primary", "", "ID"},
		{"classification", "cid", "primary", "", "CID"},
	})
	_, err := f.NewSheet("structures")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("structures", "A1", &[]any{"sid"}))
	require.NoError(t, f.SetSheetRow("structures", "A2", &[]any{"s1"}))
	_, err = f.NewSheet("main")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("main", "A1", &[]any{"id", "sid"}))
	require.NoError(t, f.SetSheetRow("main", "A2", &[]any{"1", "s1"}))
	_, err = f.NewSheet("classification")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("classification", "A1", &[]any{"cid"}))
	require.NoError(t, f.SetSheetRow("classification", "A2", &[]any{"1"}))

	_, err = appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.NoError(t, err)
}

func TestImportTablePositiveWithExternalJoin(t *testing.T) {
	store := &mockStore{imp: &mockImporter{}}
	f := excelize.NewFile()
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"__LIST__", "main", "main", "", ""},
		{"__LIST__", "classification", "classification", "", ""},
		{"main", "id", "primary", "", "ID"},
		{"main", "cls", "external[classification]", "", "Cls"},
		{"classification", "cid", "primary", "", "CID"},
		{"classification", "species", "text", "", "Species"},
	})
	_, err := f.NewSheet("main")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("main", "A1", &[]any{"id", "cls"}))
	require.NoError(t, f.SetSheetRow("main", "A2", &[]any{"1", "1"}))
	_, err = f.NewSheet("classification")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("classification", "A1", &[]any{"cid", "species"}))
	require.NoError(t, f.SetSheetRow("classification", "A2", &[]any{"1", "sp1"}))

	msg, err := appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.NoError(t, err)
	assert.Contains(t, msg, "reference check skipped")
}

func TestImportTableHiddenPrimaryAndExternalKeysJoinByPersistedValue(t *testing.T) {
	imp := &mockImporter{}
	f := excelize.NewFile()
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"__LIST__", "main", "main", "", ""},
		{"__LIST__", "classification", "classification", "", ""},
		{"main", "id", "primary", "", "ID"},
		{"main", "classification_id", "external[classification]", "", "Classification"},
		{"classification", "classification_id", "primary", "", "Classification"},
		{"classification", "species", "text", "", "Species"},
	})
	_, err := f.NewSheet("main")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("main", "A1", &[]any{"id", "classification_id"}))
	require.NoError(t, f.SetSheetRow("main", "A2", &[]any{"1", "cl#same annotation#ass"}))
	_, err = f.NewSheet("classification")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("classification", "A1", &[]any{"classification_id", "species"}))
	require.NoError(t, f.SetSheetRow("classification", "A2", &[]any{"cl#same annotation#ass", "Ruta"}))

	_, err = appcreate.ImportTable(&mockStore{imp: imp}, f, "meta", "hidden-primary-join", logging.Nop{})
	require.NoError(t, err)
	require.Positive(t, imp.batchCalls)
	require.Equal(t, 1, imp.setOkCalls)
}

func TestImportTableSQLInjectionMaliciousColumnTypeNegative(t *testing.T) {
	imp := &mockImporter{}
	store := &mockStore{imp: imp}
	f := excelize.NewFile()
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"__LIST__", "main", "main", "", ""},
		{"__LIST__", "classification", "classification", "", ""},
		{"main", "id", "primary", "", "ID"},
		{"main", "evil", "text; DROP TABLE chemdb.tables", "", "Evil"},
		{"classification", "cid", "primary", "", "CID"},
	})
	_, err := f.NewSheet("main")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("main", "A1", &[]any{"id", "evil"}))
	require.NoError(t, f.SetSheetRow("main", "A2", &[]any{"1", "payload"}))
	_, err = f.NewSheet("classification")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("classification", "A1", &[]any{"cid"}))
	require.NoError(t, f.SetSheetRow("classification", "A2", &[]any{"1"}))

	_, err = appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "preflight")
	require.Zero(t, imp.insertCalls)
	require.Zero(t, imp.batchCalls)
	require.Zero(t, imp.setOkCalls)
}

func TestImportTableSQLInjectionMaliciousColumnNameNegative(t *testing.T) {
	imp := &mockImporter{}
	store := &mockStore{imp: imp}
	f := excelize.NewFile()
	maliciousCol := "name'; DROP TABLE users; --"
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"__LIST__", "main", "main", "", ""},
		{"__LIST__", "classification", "classification", "", ""},
		{"main", "id", "primary", "", "ID"},
		{"main", maliciousCol, "text", "", "Name"},
		{"classification", "cid", "primary", "", "CID"},
	})
	_, err := f.NewSheet("main")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("main", "A1", &[]any{"id", maliciousCol}))
	require.NoError(t, f.SetSheetRow("main", "A2", &[]any{"1", "safe"}))
	_, err = f.NewSheet("classification")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("classification", "A1", &[]any{"cid"}))
	require.NoError(t, f.SetSheetRow("classification", "A2", &[]any{"1"}))

	_, err = appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unsafe Cassandra identifier")
	require.Zero(t, imp.insertCalls)
	require.Zero(t, imp.batchCalls)
	require.Zero(t, imp.setOkCalls)
}

func TestImportTableDuplicateAndMalformedDefaultPreflightHasNoWrites(t *testing.T) {
	for _, test := range []struct {
		name string
		rows [][]any
	}{
		{name: "duplicate column", rows: [][]any{
			{"sheet", "column", "type", "description", "show_name"},
			{"__LIST__", "main", "main", "", ""}, {"__LIST__", "classification", "classification", "", ""},
			{"main", "id", "primary", "", "ID"}, {"main", "ID", "text", "", "duplicate"},
			{"classification", "cid", "primary", "", "CID"},
		}},
		{name: "duplicate default", rows: [][]any{
			{"sheet", "column", "type", "description", "show_name"},
			{"__LIST__", "main", "main", "", ""}, {"__LIST__", "classification", "classification", "", ""},
			{"main", "id", "primary", "", "ID"}, {"main", "name", "default[id] default[id]", "", "Name"},
			{"classification", "cid", "primary", "", "CID"},
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			imp := &mockImporter{}
			f := fullImportWorkbook(t)
			setMetaRows(t, f, test.rows)
			_, err := appcreate.ImportTable(&mockStore{imp: imp}, f, "meta", "invalid", logging.Nop{})
			require.Error(t, err)
			require.Contains(t, err.Error(), "preflight")
			require.Zero(t, imp.insertCalls)
			require.Zero(t, imp.batchCalls)
			require.Zero(t, imp.setOkCalls)
		})
	}
}

func TestImportTableMalformedScientificModifiersHaveNoCassandraWrites(t *testing.T) {
	for _, columnType := range []string{
		"clas", "clas[]", "clas[01][]", "clas[01][tag][extra]", "clas[01] clas[02]",
		"link", "link[]", "link[url][extra]", "link[url] link[other]",
		"link[javascript:%s]", "link[data:text/html,%s]", "link[http://example.test/%s]", "link[//example.test/%s]",
		"link[%s]", "link[/%s]", "link[https://%s.example.test/path]", "link[https://user@example.test/%s]",
		"link[https://example.test/no-placeholder]", "link[https://example.test/%s/%s]", "link[https://example.test/bad path/%s]",
		"link[https://example.test/\n%s]", "link[https://example.test/%s\\evil]",
		"link[https://example.test/?id=%s]", "link[https://example.test/path#%s]", "link[https://example.test/path/ref-%s]",
		"link[/articles?id=%s]", "link[/articles#%s]", "link[/articles/ref-%s]",
		"set[]", "set[a][b]", "set[a] set", "set set[a]", "set[a] set[b]",
	} {
		t.Run(columnType, func(t *testing.T) {
			imp := &mockImporter{}
			f := fullImportWorkbook(t)
			setMetaRows(t, f, [][]any{
				{"sheet", "column", "type", "description", "show_name"},
				{"__LIST__", "main", "main", "", ""},
				{"__LIST__", "classification", "classification", "", ""},
				{"main", "id", "primary", "", "ID"},
				{"main", "name", columnType, "", "Name"},
				{"classification", "cid", "primary", "", "CID"},
				{"classification", "species", "text", "", "Species"},
			})

			_, err := appcreate.ImportTable(&mockStore{imp: imp}, f, "meta", "invalid-modifier", logging.Nop{})
			require.Error(t, err)
			require.Contains(t, err.Error(), "preflight")
			require.Zero(t, imp.insertCalls)
			require.Zero(t, imp.batchCalls)
			require.Zero(t, imp.setOkCalls)
		})
	}
}

func TestImportTableSQLInjectionMaliciousFileNameNegative(t *testing.T) {
	store := &mockStore{imp: &mockImporter{}}
	f := fullImportWorkbook(t)

	_, err := appcreate.ImportTable(store, f, "meta", "'; DELETE FROM chemdb.tables; --", logging.Nop{})
	require.NoError(t, err)
}
