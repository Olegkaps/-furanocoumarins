package create

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"admin/internal/infrastructure/persistence/cassandra"
)

// saveSourceSheets preserves every postprocessed virtual sheet before joins,
// including unreferenced entities. Original workbook declarations are retained
// separately from the enriched metadata consumed by the search UI.
func saveSourceSheets(imp cassandra.TableImporter, table *cassandra.Table, sheets map[string]*VirtualSheet, metadata map[string][]string) error {
	names := make([]string, 0, len(sheets))
	for name := range sheets {
		names = append(names, name)
	}
	sort.Strings(names)
	catalog := make([][]any, 0, len(names))
	for _, name := range names {
		sheet := sheets[name]
		kind := "source"
		switch name {
		case "classification":
			kind = "species"
		case "structures":
			kind = "chemicals"
		case "publication", "publications":
			kind = "publications"
		}
		physical := cassandra.SourceTableName(table.TableData, name)
		if name == "classification" {
			physical = table.TableSpecies
		}
		original := [][]string{}
		for _, column := range sheet.ColumnNames {
			for _, row := range metadata {
				if row[0] == name && row[1] == column {
					original = append(original, row)
				}
			}
		}
		columns, err := json.Marshal(original)
		if err != nil {
			return fmt.Errorf("source metadata %q: %w", name, err)
		}
		catalog = append(catalog, []any{name, physical, kind, sourcePrimaryColumn(sheet), sheet.RealSheetNames, string(columns), "workbook_postprocessed_unjoined"})
	}
	// Write the complete catalog first so cleanup can discover every intended
	// table even when a later write fails. Readiness remains the final mutation.
	if err := imp.CreateAndBatchInsert(cassandra.SourceCatalogName(table.TableData), []string{
		"virtual_name TEXT", "physical_table TEXT", "entity_kind TEXT", "primary_column TEXT", "source_sheet_names SET<TEXT>", "columns_json TEXT", "provenance TEXT",
	}, []string{"virtual_name"}, catalog); err != nil {
		return err
	}
	for _, name := range names {
		if name == "classification" {
			continue
		} // already saved without joins
		sheet := sheets[name]
		keys := make([]string, 0, len(sheet.Rows))
		for key := range sheet.Rows {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		rows := make([][]any, 0, len(keys))
		columns := append([]string(nil), sheet.ColumnCassTypes...)
		if sheet.KeyColumn == "" {
			columns = append(columns, sourcePrimaryColumn(sheet)+" TEXT")
		}
		for _, key := range keys {
			row := append([]any(nil), sheet.Rows[key]...)
			if sheet.KeyColumn == "" {
				row = append(row, key)
			}
			rows = append(rows, row)
		}
		if err := imp.CreateAndBatchInsert(cassandra.SourceTableName(table.TableData, name), columns, []string{sourcePrimaryColumn(sheet)}, rows); err != nil {
			return fmt.Errorf("save source sheet %q: %w", name, err)
		}
	}
	return nil
}

// Observation sheets need no natural primary key. Preserve their reader key
// only in the source table, without inventing a public or workbook column.
func sourcePrimaryColumn(sheet *VirtualSheet) string {
	if sheet.KeyColumn != "" {
		return sheet.KeyColumn
	}
	key := "source_row_key"
	for {
		collision := false
		for _, column := range sheet.ColumnNames {
			collision = collision || strings.EqualFold(column, key)
		}
		if !collision {
			return key
		}
		key += "_"
	}
}
