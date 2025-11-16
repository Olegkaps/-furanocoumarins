package excel

import (
	"fmt"
	"strings"

	"github.com/xuri/excelize/v2"
)

func ReadXLSXToMap(file *excelize.File, sheetName string, columnNames []string, keyColumn string) (map[string][]string, error) {
	rows, err := file.GetRows(sheetName)
	if err != nil {
		return nil, fmt.Errorf("can`t read Sheet %s: %w", sheetName, err)
	}

	if len(rows) == 0 {
		return map[string][]string{}, nil
	}

	header := rows[0]
	colIndices := make(map[string]int)
	for _, colName := range columnNames {
		idx := findColumnIndex(header, colName)
		if idx == -1 {
			return nil, fmt.Errorf("column %q not found in sheet %q", colName, sheetName)
		}
		colIndices[colName] = idx
	}

	var keyIdx int
	if keyColumn != "" {
		keyIdx = findColumnIndex(header, keyColumn)
		if keyIdx == -1 {
			return nil, fmt.Errorf("primary column %q not found in sheet %q", keyColumn, sheetName)
		}
	}

	result := make(map[string][]string)
	keySet := make(map[string]struct{})

	for rowNum, row := range rows[1:] {
		values := make([]string, len(columnNames))
		for i, colName := range columnNames {
			idx := colIndices[colName]
			if idx < len(row) {
				values[i] = row[idx]
			} else {
				values[i] = ""
			}
		}

		var key string
		if keyColumn == "" {
			key = strings.Join(values, "@")
		} else {
			if keyIdx >= len(row) {
				return nil, fmt.Errorf("missing key %q in row %d", keyColumn, rowNum+2)
			}
			key = row[keyIdx]
		}

		if key == "" {
			return nil, fmt.Errorf("empty key %q in row %d", keyColumn, rowNum+2)
		}
		if _, exists := keySet[key]; exists {
			return nil, fmt.Errorf("not unique key %q (duplicate at %d row)", key, rowNum+2)
		}
		keySet[key] = struct{}{}

		result[key] = values
	}

	return result, nil
}

func findColumnIndex(header []string, colName string) int {
	for i, name := range header {
		if name == colName {
			return i
		}
	}
	return -1
}

func ReadXLSXToMapMerged(file *excelize.File, sheetNames []string, columnNames []string, keyColumn string) (map[string][]string, error) {
	result := make(map[string][]string)

	for _, sheet := range sheetNames {
		curr_result, err := ReadXLSXToMap(file, sheet, columnNames, keyColumn)
		if err != nil {
			return nil, err
		}

		for key, val := range curr_result {
			if _, exists := result[key]; exists {
				return nil, fmt.Errorf("not unique key %q while merging sheet %q", key, sheet)
			}
			result[key] = val
		}
	}

	return result, nil
}
