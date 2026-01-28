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

	error_messages := []string{}
	header := rows[0]
	colIndices := make(map[string]int)
	for _, colName := range columnNames {
		idx := FindColumnIndex(header, colName)
		if idx == -1 {
			error_messages = append(error_messages, fmt.Sprintf("column %q not found", colName))
			continue
		}
		colIndices[colName] = idx
	}

	if len(error_messages) > 0 {
		return nil, fmt.Errorf("errors in sheet %q:\n%s", sheetName, strings.Join(error_messages, "\n"))
	}

	var keyIdx int
	if keyColumn != "" {
		keyIdx = FindColumnIndex(header, keyColumn)
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
				values[i] = strings.Trim(RemoveHiden(row[idx]), " ")
			} else {
				values[i] = ""
			}
		}

		var key string
		if keyColumn == "" {
			key = strings.Join(values, "\t")
		} else {
			if keyIdx >= len(row) {
				if strings.Join(values, "") == "" {
					continue
				}
				error_messages = append(error_messages, fmt.Sprintf("missing key %q in row %d", keyColumn, rowNum+2))
				continue
			}
			key = strings.Trim(row[keyIdx], " ")
		}

		if key == "" {
			if strings.Join(values, "") == "" {
				continue
			}
			error_messages = append(error_messages, fmt.Sprintf("empty key %q in row %d", keyColumn, rowNum+2))
			continue
		}
		if _, exists := keySet[key]; exists {
			error_messages = append(error_messages, fmt.Sprintf("not unique key %q (duplicate at %d row)", key, rowNum+2))
			continue
		}
		keySet[key] = struct{}{}

		result[key] = values
	}

	if len(error_messages) > 0 {
		return nil, fmt.Errorf("errors in sheet %q:\n%s", sheetName, strings.Join(error_messages, "\n"))
	}

	return result, nil
}

func FindColumnIndex(header []string, colName string) int {
	for i, name := range header {
		if name == colName {
			return i
		}
	}
	return -1
}

func ReadXLSXToMapMerged(file *excelize.File, sheetNames []string, columnNames []string, keyColumn string) (map[string][]any, error) {
	result := make(map[string][]any)

	for _, sheet := range sheetNames {
		curr_result, err := ReadXLSXToMap(file, sheet, columnNames, keyColumn)
		if err != nil {
			return nil, err
		}

		for key, val := range curr_result {
			if _, exists := result[key]; exists {
				return nil, fmt.Errorf("not unique key %q while merging sheet %q", key, sheet)
			}
			typedVal := make([]any, len(val))
			for i, v := range val {
				typedVal[i] = v
			}
			result[key] = typedVal
		}
	}

	return result, nil
}

func removeFirst(s string) string {
	start := -1
	end := -1
	for i, char := range s {
		if char == '#' {
			if start == -1 {
				start = i
			} else {
				end = i
				break
			}
		}
	}

	res := s
	if start != -1 && end != -1 {
		res = s[:start] + s[end+1:]
	}
	return res
}

func RemoveHiden(s string) string {
	res := removeFirst(s)
	for res != s {
		s = res
		res = removeFirst(s)
	}
	return res
}
