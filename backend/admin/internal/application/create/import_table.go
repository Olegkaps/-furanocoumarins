package create

import (
	"fmt"
	"maps"
	"slices"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/xuri/excelize/v2"

	appbibtex "admin/internal/application/bibtex"
	"admin/internal/application/create/excel"
	"admin/internal/infrastructure/logging"
	"admin/internal/infrastructure/persistence"
	"admin/internal/infrastructure/persistence/cassandra"
	"admin/settings"
)

type importerStore interface {
	WithImporter(fn func(cassandra.TableImporter) error) error
}

func ImportTable(
	store importerStore,
	tableFile *excelize.File,
	metaListName, fileName string,
	log logging.Logger,
) (string, error) {
	log.Info("import started: table=%s meta=%s", fileName, metaListName)

	var message string
	err := store.WithImporter(func(imp cassandra.TableImporter) error {
		var runErr error
		message, runErr = importTable(imp, tableFile, metaListName, fileName, log)
		return runErr
	})
	if err != nil {
		log.Error("import failed: table=%s err=%s", fileName, err)
		return message, err
	}
	log.Info("import finished: table=%s result=%s", fileName, message)
	return message, err
}

func importTable(
	imp cassandra.TableImporter,
	TableFile *excelize.File,
	MetaListName, FileName string,
	log logging.Logger,
) (string, error) {
	table := &cassandra.Table{
		Name:     FileName,
		Version:  settings.BackVersion,
		IsOk:     false,
		IsActive: false,
	}

	// read data
	meta_columns := []string{"sheet", "column", "type", "description", "show_name"}
	meta_result, err := excel.ReadXLSXToMap(TableFile, MetaListName, meta_columns, "")
	if err != nil {
		return "", err
	}
	log.Info("read meta sheet %q: %d rows", MetaListName, len(meta_result))
	// Only sheets contributing to the joined search view share public column
	// metadata. Independent originals may
	// legitimately reuse a column name with another definition.
	publicSheets := map[string]bool{"main": true}
	for changed := true; changed; {
		changed = false
		for _, row := range meta_result {
			if strings.HasPrefix(row[0], "__") || !publicSheets[row[0]] {
				continue
			}
			parsed, err := parseColumnType(row[2])
			if err != nil {
				return "", fmt.Errorf("preflight column %q: %w", row[1], err)
			}
			if parsed.hasExternal && !publicSheets[parsed.external] {
				publicSheets[parsed.external] = true
				changed = true
			}
		}
	}

	// insert meta in db

	var ref_col = ""
	var meta_data [][]any
	var meta_keys = make(map[string]string)
	for _, row := range meta_result {
		sheet := row[0]
		column := row[1]
		c_type := row[2]
		c_decr := row[3]
		c_name := row[4]
		if strings.HasPrefix(sheet, "__") {
			continue
		}
		if err := cassandra.ValidateIdentifier(column); err != nil {
			return "", fmt.Errorf("preflight column %q: %w", column, err)
		}
		parsedType, err := parseColumnType(c_type)
		if err != nil {
			return "", fmt.Errorf("preflight column %q: %w", column, err)
		}
		if !publicSheets[sheet] {
			continue
		}

		externalSheet, hasExternal := parsedType.external, parsedType.hasExternal
		if (hasExternal && (externalSheet == "structures" || externalSheet == "classification")) ||
			(sheet == "structures" && parsedType.hasToken("primary")) ||
			(sheet == "classification" && parsedType.hasToken("primary")) {
			c_type += " keycolumn"
		}

		if strings.HasPrefix(sheet, "structures") || externalSheet == "structures" {
			c_type += " chemical"
		} else if strings.HasPrefix(sheet, "classification") || externalSheet == "classification" {
			c_type += " specie"
		}

		if parsedType.hasToken("ref[]") {
			ref_col = column
		}

		if val, exists := meta_keys[column]; exists {
			c_type_old := strings.Split(val, "\t")[0]
			c_desr_old := strings.Split(val, "\t")[1]

			isTypesIdentical, compareErr := equalColumnTypes(c_type_old, c_type)
			if compareErr != nil {
				return "", fmt.Errorf("preflight column %q: %w", column, compareErr)
			}

			if c_desr_old != c_decr || !isTypesIdentical {
				return "", fmt.Errorf("%s", fmt.Sprintf(
					"column '%s' has different descriptions in different rows:\n",
					column,
				)+fmt.Sprintf(
					" - descriptions:\n\t'%s'\n\t'%s'\n",
					c_decr, c_desr_old,
				)+fmt.Sprintf(
					" - types (may differ only by primary/external):\n\t'%s'\n\t'%s'\n",
					c_type, c_type_old,
				))
			}
		} else {
			meta_data = append(meta_data, []any{sheet, column, c_type, c_decr, c_name})
		}

		meta_keys[column] = c_type + "\t" + c_decr
	}

	// normally parse meta
	parsed_meta := make(map[string]*VirtualSheet)
	seenSheetColumns := make(map[string]map[string]struct{})
	for _, row := range meta_result {
		// meta_names := []string{"sheet", "column", "type", "description"}
		name := row[0]

		if name != "__LIST__" {
			continue
		}
		sheet_name := row[1]
		v_name := row[2]

		if _, ok := parsed_meta[v_name]; !ok {
			parsed_meta[v_name] = NewVirtualSheet()
		}
		parsed_meta[v_name].RealSheetNames = append(parsed_meta[v_name].RealSheetNames, sheet_name)
	}

	for _, row := range meta_result {
		// meta_names := []string{"sheet", "column", "type", "description", "show_name"}
		name := row[0]

		if name == "__LIST__" {
			continue
		}

		if _, ok := parsed_meta[name]; !ok {
			err = fmt.Errorf("got unknown sheet name '%s'. Did you register this sheet as __LIST__ ?", name)
			return "", err
		}

		column_name := row[1]
		column_type := row[2]
		parsedType, parseErr := parseColumnType(column_type)
		if parseErr != nil {
			return "", fmt.Errorf("preflight column %q: %w", column_name, parseErr)
		}
		if _, ok := seenSheetColumns[name]; !ok {
			seenSheetColumns[name] = make(map[string]struct{})
		}
		columnKey := strings.ToLower(column_name)
		if _, duplicate := seenSheetColumns[name][columnKey]; duplicate {
			return "", fmt.Errorf("preflight sheet %q has duplicate column identifier %q", name, column_name)
		}
		seenSheetColumns[name][columnKey] = struct{}{}
		parsed_meta[name].ColumnNames = append(parsed_meta[name].ColumnNames, column_name)
		parsed_meta[name].ColumnTypes = append(parsed_meta[name].ColumnTypes, column_type)

		if parsedType.hasToken("primary") {
			if parsedType.hasToken("set") {
				return "", fmt.Errorf("preflight sheet %q: primary column %q must be scalar, not set", name, column_name)
			}
			if parsed_meta[name].KeyColumn != "" {
				return "", fmt.Errorf("preflight sheet %q has more than one primary column", name)
			}
			parsed_meta[name].KeyColumn = column_name
		}
	}

	for name, v_sheet := range parsed_meta {
		if v_sheet.KeyColumn == "" && name != "main" {
			return "", fmt.Errorf("preflight sheet %q has no primary column", name)
		}
		err = v_sheet.ReadFile(TableFile)
		if err != nil {
			return "", err
		}
		err = v_sheet.Postprocess()
		if err != nil {
			return "", err
		}
		log.Info("parsed virtual sheet %q: rows=%d", name, len(v_sheet.Rows))
	}

	// insert species
	// parsed_meta[classification]
	species_sheet, ok := parsed_meta["classification"]
	if !ok {
		err = fmt.Errorf("missing classifaction in meta. Did you register this sheet as __LIST__ ?")
		return "", err
	}

	used_uuids := make(map[string]struct{}, len(species_sheet.Rows))
	id := uuid.New().String()

	sp_columns := append([]string(nil), species_sheet.ColumnCassTypes...)
	sp_columns = append(sp_columns, "uuid UUID")
	if err := validateUniqueColumnDefinitions("species", sp_columns); err != nil {
		return "", err
	}
	sp_data := make([][]any, len(species_sheet.Rows))
	i := 0
	for _, row := range species_sheet.Rows {
		for {
			if _, exists := used_uuids[id]; !exists {
				break
			}
			id = uuid.New().String()
		}

		sp_data[i] = append(row, id)
		used_uuids[id] = struct{}{}
		i++
	}

	// insert data
	// parsed_meta[main]
	main_sheet, ok := parsed_meta["main"]
	if !ok {
		err = fmt.Errorf("missing main sheet in meta. Did you register this sheet as __LIST__ ?")
		return "", err
	}

	// WARN: joins almost repeats
	// join metadata of all sheets
	data_columns := []string{"uuid UUID"}
	sheet_to_count := make(map[*VirtualSheet]int)
	sheet_to_count[main_sheet] = 0

	stack_of_lists := []*VirtualSheet{main_sheet}

	for len(stack_of_lists) > 0 {
		curr_sheet := stack_of_lists[len(stack_of_lists)-1]
		ind := sheet_to_count[curr_sheet]
		sheet_to_count[curr_sheet]++

		if len(curr_sheet.ArrangeOfExternals) <= ind {
			stack_of_lists = stack_of_lists[:len(stack_of_lists)-1]
			continue
		}

		curr_arrange := curr_sheet.ArrangeOfExternals[ind]
		if curr_arrange == "" {
			data_columns = append(data_columns, curr_sheet.ColumnCassTypes[ind])
		} else {
			next_sheet, ok := parsed_meta[curr_arrange]
			if !ok {
				err = fmt.Errorf("sheet '%s' which is used as 'external' not found", curr_arrange)
				return "", err
			}
			if _, is_used := sheet_to_count[next_sheet]; is_used {
				err = fmt.Errorf("sheet '%s' used twice or gets in cycle as 'external'", curr_arrange)
				return "", err
			}

			sheet_to_count[next_sheet] = 0
			stack_of_lists = append(stack_of_lists, next_sheet)
		}
	}
	if err := validateUniqueColumnDefinitions("data", data_columns); err != nil {
		return "", err
	}

	// WARN: joins almost repeats
	// join data of all sheets
	joined_data := [][]any{}
	var joined_row []any
	not_found_primary_key_messages := make(map[string]struct{})

	used_uuids = make(map[string]struct{}, len(main_sheet.Rows))
	id = uuid.New().String()

	for key := range main_sheet.Rows {
		joined_row = make([]any, len(data_columns))
		for {
			if _, exists := used_uuids[id]; !exists {
				break
			}
			id = uuid.New().String()
		}
		joined_row[0] = id
		used_uuids[id] = struct{}{}
		row_ind := 1

		sheet_to_count = make(map[*VirtualSheet]int)
		sheet_to_count[main_sheet] = 0

		stack_of_lists = []*VirtualSheet{main_sheet}
		stack_of_primary_keys := []string{key}

		for len(stack_of_lists) > 0 {
			curr_sheet := stack_of_lists[len(stack_of_lists)-1]
			curr_primary_key := stack_of_primary_keys[len(stack_of_primary_keys)-1]
			ind := sheet_to_count[curr_sheet]
			sheet_to_count[curr_sheet]++

			if len(curr_sheet.ArrangeOfExternals) <= ind {
				stack_of_lists = stack_of_lists[:len(stack_of_lists)-1]
				stack_of_primary_keys = stack_of_primary_keys[:len(stack_of_primary_keys)-1]
				continue
			}
			currentRow, rowExists := curr_sheet.Rows[curr_primary_key]
			if !rowExists || ind >= len(currentRow) {
				message := fmt.Sprintf("Not found primary key '%s' in sheet with key column '%s'", curr_primary_key, curr_sheet.KeyColumn)
				not_found_primary_key_messages[message] = struct{}{}
				break
			}

			curr_arrange := curr_sheet.ArrangeOfExternals[ind]
			if curr_arrange == "" {
				joined_row[row_ind] = currentRow[ind]
				row_ind++

			} else {
				next_sheet, ok := parsed_meta[curr_arrange]
				if !ok {
					err = fmt.Errorf("sheet '%s' which is used as 'external' not found", curr_arrange)
					return "", err
				}
				if _, is_used := sheet_to_count[next_sheet]; is_used {
					err = fmt.Errorf("sheet '%s' used twice or gets in cycle as 'external'", curr_arrange)
					return "", err
				}

				sheet_to_count[next_sheet] = 0
				stack_of_lists = append(stack_of_lists, next_sheet)

				next_primary_key, ok := currentRow[ind].(string)
				if !ok {
					return "", fmt.Errorf("external key in sheet %q column %q is not text", curr_arrange, curr_sheet.ColumnNames[ind])
				}
				stack_of_primary_keys = append(stack_of_primary_keys, next_primary_key)
			}
		}

		joined_data = append(joined_data, joined_row)
	}

	if len(not_found_primary_key_messages) > 0 {
		messages := make([]string, 0, len(not_found_primary_key_messages))
		for message := range not_found_primary_key_messages {
			messages = append(messages, message)
		}
		err = fmt.Errorf("%s", strings.Join(messages, "\n"))
		return "", err
	}

	data_primary_keys := []string{"uuid"}
	if err := populateSetChoices(meta_data, data_columns, joined_data, sp_columns, sp_data); err != nil {
		return "", err
	}

	// All workbook metadata and joins are validated before the first Cassandra
	// mutation. Persistence failures after reserving the table intentionally leave the
	// existing observable Broken-table workflow intact.
	if err := reserveUniqueTable(imp, table, time.Now()); err != nil {
		return "", err
	}
	log.Info("reserved table records: meta=%s data=%s species=%s", table.TableMeta, table.TableData, table.TableSpecies)
	if err := imp.CreateAndBatchInsert(
		table.TableMeta,
		[]string{"sheet TEXT", "column TEXT", "type TEXT", "description TEXT", "show_name TEXT"},
		[]string{"column"},
		meta_data,
	); err != nil {
		return "", err
	}
	log.Info("inserted meta columns: count=%d", len(meta_data))
	if err := imp.CreateAndBatchInsert(table.TableSpecies, sp_columns, []string{"uuid"}, sp_data); err != nil {
		return "", err
	}
	log.Info("inserted species rows: count=%d", len(sp_data))
	err = imp.CreateAndBatchInsert(
		table.TableData,
		data_columns,
		data_primary_keys,
		joined_data,
	)
	if err != nil {
		return "", err
	}
	log.Info("inserted data rows: count=%d columns=%d", len(joined_data), len(data_columns))
	if err := saveSourceSheets(imp, table, parsed_meta, meta_result); err != nil {
		return "", err
	}

	// The PostgreSQL store creates a lower-case B-tree index for text and a
	// GIN membership index for searchable sets.
	for _, row := range meta_result {
		// meta_names := []string{"sheet", "column", "type", "description", "show_name"}
		if !publicSheets[row[0]] {
			continue
		}
		_type := row[2]
		parsedType, parseErr := parseColumnType(_type)
		if parseErr != nil {
			return "", parseErr
		}
		if parsedType.hasToken("search") && !parsedType.hasExternal {
			if !slices.ContainsFunc(data_columns, func(def string) bool { return strings.Fields(def)[0] == row[1] }) {
				continue // searchable source-only columns are absent from the joined view
			}
			err = imp.CreateSASIIndex(table.TableData, row[1])
			if err != nil {
				return "", err
			}
			log.Info("created search index on column %q", row[1])
		}
	}

	// Complete every reference validation before the final readiness mutation.
	// The async tracker may report Ready only after this function returns, so no
	// fallible validation may remain after SetTableOk.
	ref_ind := -1
	for i, col_def := range data_columns {
		if ref_col == strings.Split(col_def, " ")[0] {
			ref_ind = i
		}
	}

	message := "Column with type 'ref[]' not found, reference check skipped."
	if ref_ind == -1 {
		log.Warn("column with type ref[] not found, reference check skipped")
	} else {
		ids_to_check := make([]string, len(joined_data))
		for i, row := range joined_data {
			ref_id, ok := row[ref_ind].(string)
			if !ok {
				return "", fmt.Errorf("reference column %q contains a non-text value", ref_col)
			}
			ids_to_check[i] = ref_id
		}

		corr_ids, err := imp.GetArticleIds()
		if err != nil {
			return "", err
		}

		warnings := appbibtex.CheckArticleIDs(corr_ids, ids_to_check)

		if len(warnings) == 0 {
			message = "Reference check passed"
		} else {
			message = "Failed reference checks: " + strings.Join(warnings, "\n")
		}
		log.Info("reference check: warnings=%d", len(warnings))
	}

	// This is deliberately the final mutation and final external call. Once it
	// succeeds, the handler can publish Ready without disagreeing with is_ok.
	if err := imp.SetTableOk(table); err != nil {
		return "", err
	}
	return message, nil
}

// populateSetChoices enriches persisted metadata only. Choices come from the
// final imported rows (after defaults and joins), never from spreadsheet edits
// or unreferenced source rows. Explicit workbook choices remain authoritative.
func populateSetChoices(meta [][]any, dataColumns []string, data [][]any, speciesColumns []string, species [][]any) error {
	for _, row := range meta {
		column, columnType := row[1].(string), row[2].(string)
		parsed, err := parseColumnType(columnType)
		if err != nil {
			return err
		}
		if !parsed.hasToken("set") || parsed.hasSetChoices {
			continue
		}
		unique := make(map[string]struct{})
		collect := func(columns []string, rows [][]any) {
			for index, definition := range columns {
				if strings.Fields(definition)[0] != column {
					continue
				}
				for _, values := range rows {
					if set, ok := values[index].(map[string]struct{}); ok {
						maps.Copy(unique, set)
					}
				}
			}
		}
		collect(dataColumns, data)
		collect(speciesColumns, species)
		choices := make([]string, 0, len(unique))
		for value := range unique {
			// The legacy metadata grammar has no escaping. Reject ambiguity before
			// reserving a table instead of publishing broken dropdown options.
			if strings.ContainsAny(value, "[]") || strings.IndexFunc(value, func(r rune) bool {
				return unicode.IsSpace(r) || unicode.IsControl(r)
			}) >= 0 || value == "<>" {
				return fmt.Errorf("preflight column %q: set value %q cannot be represented in set[choices] metadata", column, value)
			}
			choices = append(choices, value)
		}
		slices.Sort(choices)
		declaration := "set"
		if len(choices) != 0 {
			declaration += "[" + strings.Join(choices, " ") + "]"
		}
		row[2] = columnType[:parsed.setStart] + declaration + columnType[parsed.setEnd:]
	}
	return nil
}

// equalColumnTypes compares semantic metadata tokens while ignoring the two
// location-specific modifiers that legitimately differ between a primary key
// definition and a reference to it. Modifier arguments are never tokenized as
// ordinary labels (for example external[sunset] does not contain "set").
func equalColumnTypes(left, right string) (bool, error) {
	leftType, err := parseColumnType(left)
	if err != nil {
		return false, err
	}
	rightType, err := parseColumnType(right)
	if err != nil {
		return false, err
	}
	delete(leftType.tokens, "primary")
	delete(rightType.tokens, "primary")
	return maps.Equal(leftType.tokens, rightType.tokens) &&
		leftType.hasDefaultColumn == rightType.hasDefaultColumn &&
		leftType.defaultColumn == rightType.defaultColumn &&
		leftType.hasClassification == rightType.hasClassification &&
		leftType.classificationLevel == rightType.classificationLevel &&
		leftType.classificationTag == rightType.classificationTag &&
		leftType.hasLink == rightType.hasLink &&
		leftType.linkTemplate == rightType.linkTemplate &&
		leftType.hasSetChoices == rightType.hasSetChoices &&
		leftType.setChoices == rightType.setChoices, nil
}

// ColumnTypesEquivalent compares every supported semantic label and modifier,
// while allowing the documented primary/external location difference.
func ColumnTypesEquivalent(left, right string) (bool, error) {
	return equalColumnTypes(left, right)
}

func validateUniqueColumnDefinitions(scope string, definitions []string) error {
	seen := make(map[string]struct{}, len(definitions))
	for _, definition := range definitions {
		fields := strings.Fields(definition)
		if len(fields) != 2 {
			return fmt.Errorf("preflight %s column definition %q is invalid", scope, definition)
		}
		if err := cassandra.ValidateIdentifier(fields[0]); err != nil {
			return fmt.Errorf("preflight %s column: %w", scope, err)
		}
		key := strings.ToLower(fields[0])
		if _, duplicate := seen[key]; duplicate {
			return fmt.Errorf("preflight %s has duplicate column identifier %q", scope, fields[0])
		}
		seen[key] = struct{}{}
	}
	return nil
}

const tableReservationAttempts = 1024

func reserveUniqueTable(imp cassandra.TableImporter, table *cassandra.Table, base time.Time) error {
	base = base.UTC().Truncate(time.Millisecond)
	for attempt := 0; attempt < tableReservationAttempts; attempt++ {
		candidate := base.Add(time.Duration(attempt) * time.Millisecond)
		fixed := persistence.FixCassandraTimestamp(candidate.Format("2006-01-02T15:04:05.000"))
		table.Timestamp = candidate
		table.TableMeta = "chemdb.meta_" + fixed
		table.TableData = "chemdb.data_" + fixed
		table.TableSpecies = "chemdb.species_" + fixed
		applied, err := imp.ReserveTable(table)
		if err != nil {
			// A CAS transport error has an uncertain apply outcome. Never try a
			// second key, which could reserve two registry rows for one import.
			return fmt.Errorf("reserve table registry row: %w", err)
		}
		if applied {
			return nil
		}
	}
	return fmt.Errorf("cannot reserve a unique table timestamp after %d attempts", tableReservationAttempts)
}
