package create

import (
	"admin/routes/create/excel"
	"admin/settings"
	"fmt"
	"slices"
	"strings"

	"github.com/xuri/excelize/v2"
)

type VirtualSheet struct {
	ArrangeOfExternals []string // shows how to join data from different sheets
	RealSheetNames     []string
	ColumnNames        []string
	ColumnTypes        []string // unprocessed types
	ColumnCassTypes    []string // types to use in Cassandra
	KeyColumn          string
	Rows               map[string][]any
	is_postprocessed   bool
}

func NewVirtualSheet() *VirtualSheet {
	return &VirtualSheet{
		[]string{},
		[]string{},
		[]string{},
		[]string{},
		[]string{},
		"",
		make(map[string][]any),
		false,
	}
}

func (v_sheet *VirtualSheet) ReadFile(file *excelize.File) error {
	rows, err := excel.ReadXLSXToMapMerged(file, v_sheet.RealSheetNames, v_sheet.ColumnNames, v_sheet.KeyColumn)
	v_sheet.Rows = map[string][]any(rows)
	return err
}

func split_set(r rune) bool {
	return slices.Contains(settings.CASSANDRA_COLLECTION_SEPARATORS, r)
}

func (v_sheet *VirtualSheet) Postprocess() error {
	if v_sheet.is_postprocessed {
		return nil
	}
	error_messages := []string{}

	meta_defaults := make(map[string]map[string]any)

	for i, _type := range v_sheet.ColumnTypes {
		if !strings.Contains(_type, "default[") {
			continue
		}

		default_col := strings.Split(strings.Split(_type, "default[")[1], "]")[0]
		default_ind := excel.FindColumnIndex(v_sheet.ColumnNames, default_col)
		if default_ind == -1 {
			error_messages = append(error_messages, fmt.Sprintf(
				"bad type '%s', cannot find default column '%s'",
				_type, default_col,
			))
			continue
		}

		if _, exist := meta_defaults[default_col]; !exist {
			meta_defaults[default_col] = map[string]any{"default": default_ind, "custom": []int{}}
		}

		meta_defaults[default_col]["custom"] = append(meta_defaults[default_col]["custom"].([]int), i)
	}

	for key, row := range v_sheet.Rows {
		// default cols
		for _, m := range meta_defaults {
			default_col := m["default"].(int)
			for _, custom_col := range m["custom"].([]int) {
				if row[custom_col] != "" {
					continue
				}
				row[custom_col] = row[default_col]
			}
		}

		// type checks
		for j, item := range row {
			if strings.Contains(v_sheet.ColumnTypes[j], "external[") && item == "" {
				error_messages = append(error_messages, fmt.Sprintf(
					"missing external key in row with primary key '%s' for column '%s'",
					key, v_sheet.ColumnNames[j],
				))
				continue
			}

			if strings.Contains(v_sheet.ColumnTypes[j], "set") {
				set_values := make(map[string]struct{})
				for _, val := range strings.FieldsFunc(item.(string), split_set) {
					set_values[val] = struct{}{}
				}
				v_sheet.Rows[key][j] = set_values
			} else { // default
				if item == "" {
					v_sheet.Rows[key][j] = " "
				}
			}
		}
	}

	if len(error_messages) > 0 {
		return fmt.Errorf("errors in sheet with key column '%s':\n%s",
			v_sheet.KeyColumn,
			strings.Join(error_messages, "\n"),
		)
	}

	v_sheet.ColumnCassTypes = make([]string, len(v_sheet.ColumnTypes))
	for i, _type := range v_sheet.ColumnTypes {
		col_name := v_sheet.ColumnNames[i]
		if strings.Contains(_type, "set") {
			v_sheet.ColumnCassTypes[i] = col_name + " SET<TEXT>"
		} else { // default
			v_sheet.ColumnCassTypes[i] = col_name + " TEXT"
		}
	}

	v_sheet.ArrangeOfExternals = make([]string, len(v_sheet.ColumnTypes))
	for i, _type := range v_sheet.ColumnTypes {
		arrange := ""

		// find 'external[<name>]'
		if strings.Contains(_type, "external") {
			arrange = strings.Split(
				strings.Split(_type, "external[")[1],
				"]",
			)[0]
		}
		v_sheet.ArrangeOfExternals[i] = arrange
	}

	v_sheet.is_postprocessed = true
	return nil
}
