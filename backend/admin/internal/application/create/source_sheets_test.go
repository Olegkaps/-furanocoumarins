package create_test

import (
	"encoding/json"
	"strings"
	"testing"

	appcreate "admin/internal/application/create"
	"admin/internal/infrastructure/logging"
	"admin/internal/infrastructure/persistence/cassandra"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"
)

type sourceBatch struct {
	columns, keys []string
	rows          [][]any
}
type sourceCapture struct {
	mockImporter
	batches map[string]sourceBatch
	table   cassandra.Table
}

func (m *sourceCapture) ReserveTable(table *cassandra.Table) (bool, error) {
	m.table = *table
	return m.mockImporter.ReserveTable(table)
}
func (m *sourceCapture) CreateAndBatchInsert(n string, c, k []string, r [][]any) error {
	if m.batches == nil {
		m.batches = make(map[string]sourceBatch)
	}
	m.batches[n] = sourceBatch{c, k, r}
	return m.mockImporter.CreateAndBatchInsert(n, c, k, r)
}

func sourceWorkbook(t *testing.T) *excelize.File {
	t.Helper()
	f := excelize.NewFile()
	setMetaRows(t, f, [][]any{
		{"sheet", "column", "type", "description", "show_name"},
		{"__LIST__", "observations", "main", "", ""},
		{"__LIST__", "species", "classification", "", ""},
		{"__LIST__", "chemicals", "structures", "", ""},
		{"__LIST__", "papers", "publications", "", ""},
		{"main", "observation_id", "primary", "", "Observation"},
		{"main", "chemical_id", "external[structures]", "", "Chemical ID"},
		{"main", "species_id", "external[classification]", "", "Species ID"},
		{"classification", "species_id", "primary", "", "Species ID"},
		{"classification", "species_name", "text", "", "Species"},
		{"structures", "chemical_id", "primary", "", "Chemical ID"},
		{"structures", "aliases", "set[<>] search", "original choices", "Aliases"},
		{"publications", "paper_id", "primary", "", "Paper ID"},
		{"publications", "title", "text search", "", "Title"},
	})
	for name, rows := range map[string][][]any{
		"observations": {{"observation_id", "chemical_id", "species_id"}, {"obs-1", "chem-1", "sp-1"}},
		"species":      {{"species_id", "species_name"}, {"sp-1", "Ruta"}, {"sp-unused", "Unreferenced species"}},
		"chemicals":    {{"chemical_id", "aliases"}, {"chem-1", "Psoralen Bergapten"}, {"chem-unused", "Unreferenced"}},
		"papers":       {{"paper_id", "title"}, {"paper-unused", "Unreferenced publication"}},
	} {
		_, err := f.NewSheet(name)
		require.NoError(t, err)
		for i, row := range rows {
			cell, err := excelize.CoordinatesToCellName(1, i+1)
			require.NoError(t, err)
			require.NoError(t, f.SetSheetRow(name, cell, &row))
		}
	}
	return f
}

func TestImportKeylessObservationsPreserveDuplicateRowsAndSourceIdentity(t *testing.T) {
	f := sourceWorkbook(t)
	defer f.Close()
	require.NoError(t, f.SetCellValue("meta", "C6", ""))
	// A real workbook column must never be overwritten by the generated key.
	require.NoError(t, f.SetCellValue("meta", "B6", "source_row_key"))
	require.NoError(t, f.SetCellValue("observations", "A1", "source_row_key"))
	require.NoError(t, f.SetSheetRow("observations", "A3", &[]any{"obs-1", "chem-1", "sp-1"}))
	require.NoError(t, f.SetSheetRow("observations", "A5", &[]any{"obs-2", "chem-1", "sp-1"}))
	_, err := f.NewSheet("observations2")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("observations2", "A1", &[]any{"source_row_key", "chemical_id", "species_id"}))
	require.NoError(t, f.SetSheetRow("observations2", "A2", &[]any{"obs-1", "chem-1", "sp-1"}))
	require.NoError(t, f.SetSheetRow("meta", "A15", &[]any{"__LIST__", "observations2", "main", "", ""}))
	imp := &sourceCapture{}
	_, err = appcreate.ImportTable(&mockStore{imp: imp}, f, "meta", "keyless", logging.Nop{})
	require.NoError(t, err)
	source := imp.batches[cassandra.SourceTableName(imp.table.TableData, "main")]
	require.Equal(t, []string{"source_row_key_"}, source.keys)
	require.Contains(t, source.columns, "source_row_key TEXT")
	require.Contains(t, source.columns, "source_row_key_ TEXT")
	require.Len(t, source.rows, 4)
	seen := map[any]bool{}
	for _, row := range source.rows {
		require.False(t, seen[row[len(row)-1]])
		seen[row[len(row)-1]] = true
	}
	require.Len(t, imp.batches[imp.table.TableData].rows, 4)
	for _, row := range imp.batches[cassandra.SourceCatalogName(imp.table.TableData)].rows {
		if row[0] == "main" {
			require.Equal(t, "source_row_key_", row[3])
			var original [][]string
			require.NoError(t, json.Unmarshal([]byte(row[5].(string)), &original))
			require.Len(t, original, 3)
		}
	}
}

func TestImportPreservesUnjoinedSourceSheetsAndOriginalMetadata(t *testing.T) {
	f := sourceWorkbook(t)
	defer f.Close()
	imp := &sourceCapture{}
	_, err := appcreate.ImportTable(&mockStore{imp: imp}, f, "meta", "sources", logging.Nop{})
	require.NoError(t, err)
	catalog := imp.batches[cassandra.SourceCatalogName(imp.table.TableData)]
	require.Len(t, catalog.rows, 4)
	for _, row := range catalog.rows {
		name := row[0].(string)
		require.Equal(t, "workbook_postprocessed_unjoined", row[6])
		physical := row[1].(string)
		if name == "classification" {
			require.Equal(t, imp.table.TableSpecies, physical)
		}
		require.NoError(t, cassandra.ValidateSourceTable(imp.table.TableData, imp.table.TableSpecies, name, physical))
		var original [][]string
		require.NoError(t, json.Unmarshal([]byte(row[5].(string)), &original))
		require.NotEmpty(t, original)
		originalTypes := map[string]string{}
		for _, declaration := range original {
			originalTypes[declaration[1]] = declaration[2]
		}
		columnIndex := func(column string) int {
			for index, def := range imp.batches[physical].columns {
				if strings.Fields(def)[0] == column {
					return index
				}
			}
			t.Fatalf("missing column %s", column)
			return -1
		}
		switch name {
		case "structures":
			require.Equal(t, "chemicals", row[2])
			require.Len(t, imp.batches[physical].rows, 2)
			require.Equal(t, "set[<>] search", originalTypes["aliases"])
			require.Equal(t, map[string]struct{}{"Unreferenced": {}}, imp.batches[physical].rows[1][columnIndex("aliases")])
		case "main":
			for column, value := range map[string]string{"observation_id": "obs-1", "chemical_id": "chem-1", "species_id": "sp-1"} {
				require.Equal(t, value, imp.batches[physical].rows[0][columnIndex(column)])
			}
			require.Equal(t, "external[structures]", originalTypes["chemical_id"])
		case "classification":
			require.Len(t, imp.batches[physical].rows, 2)
		case "publications":
			require.Equal(t, "publications", row[2])
			require.Len(t, imp.batches[physical].rows, 1)
		}
	}
	require.Len(t, imp.batches[imp.table.TableData].rows, 1)
	for _, row := range imp.batches[imp.table.TableMeta].rows {
		require.NotEqual(t, "publications", row[0], "source-only fields must not leak into search metadata")
	}
	require.Equal(t, "set_ok", imp.calls[len(imp.calls)-1])
	for _, batch := range imp.batches {
		for _, col := range batch.columns {
			require.False(t, strings.Contains(col, "external["))
		}
	}
}

func TestSourcePersistenceFailureNeverPublishesReady(t *testing.T) {
	for _, failure := range []int{4, 5, 6, 7} {
		f := sourceWorkbook(t)
		imp := &sourceCapture{mockImporter: mockImporter{batchErr: assertSourceError{}, batchErrOn: failure}}
		_, err := appcreate.ImportTable(&mockStore{imp: imp}, f, "meta", "broken-sources", logging.Nop{})
		f.Close()
		require.Error(t, err)
		require.Zero(t, imp.setOkCalls)
	}
}

type assertSourceError struct{}

func (assertSourceError) Error() string { return "source write failed" }

func TestSourcePrimarySetRejectedBeforeReservation(t *testing.T) {
	f := sourceWorkbook(t)
	defer f.Close()
	require.NoError(t, f.SetCellValue("meta", "C13", "primary set"))
	imp := &sourceCapture{}
	_, err := appcreate.ImportTable(&mockStore{imp: imp}, f, "meta", "invalid-primary", logging.Nop{})
	require.ErrorContains(t, err, "must be scalar")
	require.Zero(t, imp.insertCalls)
}

func TestIndependentSourceMetadataMayReuseColumnNames(t *testing.T) {
	f := sourceWorkbook(t)
	defer f.Close()
	require.NoError(t, f.SetCellValue("meta", "B14", "aliases"))
	require.NoError(t, f.SetCellValue("papers", "B1", "aliases"))
	imp := &sourceCapture{}
	_, err := appcreate.ImportTable(&mockStore{imp: imp}, f, "meta", "independent-column", logging.Nop{})
	require.NoError(t, err)
}

func TestEmptyOptionalSourceAndEmptySetPreserved(t *testing.T) {
	f := sourceWorkbook(t)
	defer f.Close()
	require.NoError(t, f.RemoveRow("papers", 2))
	require.NoError(t, f.SetCellValue("chemicals", "B3", ""))
	imp := &sourceCapture{}
	_, err := appcreate.ImportTable(&mockStore{imp: imp}, f, "meta", "empty-sources", logging.Nop{})
	require.NoError(t, err)
	publication := imp.batches[cassandra.SourceTableName(imp.table.TableData, "publications")]
	require.Empty(t, publication.rows)
	require.Len(t, publication.columns, 2)
	chemical := imp.batches[cassandra.SourceTableName(imp.table.TableData, "structures")]
	for index, column := range chemical.columns {
		if strings.Fields(column)[0] == "aliases" {
			require.Equal(t, map[string]struct{}{}, chemical.rows[1][index])
		}
	}
	require.Len(t, imp.batches[cassandra.SourceCatalogName(imp.table.TableData)].rows, 4)
}
