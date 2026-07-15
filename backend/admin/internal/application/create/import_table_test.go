package create_test

import (
	"errors"
	"strings"
	"testing"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"

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
}

func (m *mockImporter) InsertTable(_ *cassandra.Table) error { return m.insertErr }

func (m *mockImporter) CreateAndBatchInsert(tableName string, columnDefs, primaryKeys []string, data [][]any) error {
	m.batchCalls++
	m.lastBatchTable = tableName
	m.lastBatchCols = columnDefs
	if m.batchErr != nil && m.batchCalls == m.batchErrOn {
		return m.batchErr
	}
	return nil
}

func (m *mockImporter) SetTableOk(_ *cassandra.Table) error { return m.setOkErr }

func (m *mockImporter) GetArticleIds() (map[string]string, error) {
	if m.getArticleErr != nil {
		return nil, m.getArticleErr
	}
	if m.articleIDs != nil {
		return m.articleIDs, nil
	}
	return map[string]string{}, nil
}

func (m *mockImporter) CreateSASIIndex(string, string) error { return m.sasiErr }

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
	f := metaWorkbook(t)

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
	store := &mockStore{imp: &mockImporter{}}
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
	store := &mockStore{imp: &mockImporter{setOkErr: errors.New("set ok failed")}}
	f := fullImportWorkbook(t)

	_, err := appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "set ok failed")
}

func TestImportTablePositiveRefCheckPassed(t *testing.T) {
	store := &mockStore{imp: &mockImporter{articleIDs: map[string]string{"art1": "bib"}}}
	f := refImportWorkbook(t)

	msg, err := appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.NoError(t, err)
	assert.Equal(t, "Reference check passed", msg)
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
	store := &mockStore{imp: &mockImporter{getArticleErr: errors.New("articles failed")}}
	f := refImportWorkbook(t)

	_, err := appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "articles failed")
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

func TestImportTableSQLInjectionMaliciousColumnTypeNegative(t *testing.T) {
	store := &mockStore{imp: &mockImporter{}}
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

	imp := store.imp.(*mockImporter)
	_, err = appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.NoError(t, err)
	for _, colDef := range imp.lastBatchCols {
		assert.NotContains(t, colDef, "DROP TABLE chemdb.tables")
	}
}

func TestImportTableSQLInjectionMaliciousColumnNameNegative(t *testing.T) {
	store := &mockStore{imp: &mockImporter{}}
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

	imp := store.imp.(*mockImporter)
	_, err = appcreate.ImportTable(store, f, "meta", "test-table", logging.Nop{})
	require.NoError(t, err)
	found := false
	for _, colDef := range imp.lastBatchCols {
		if strings.Contains(colDef, maliciousCol) {
			found = true
		}
	}
	assert.True(t, found, "malicious column name should be passed as literal identifier")
}

func TestImportTableSQLInjectionMaliciousFileNameNegative(t *testing.T) {
	store := &mockStore{imp: &mockImporter{}}
	f := fullImportWorkbook(t)

	_, err := appcreate.ImportTable(store, f, "meta", "'; DELETE FROM chemdb.tables; --", logging.Nop{})
	require.NoError(t, err)
}
