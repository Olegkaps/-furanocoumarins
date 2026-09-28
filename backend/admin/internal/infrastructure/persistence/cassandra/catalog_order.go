package cassandra

import (
	"fmt"
	"regexp"
	"strings"
)

var catalogNameColumn = regexp.MustCompile(`(?i)^(chemical_?name|name|names|title)$`)
var catalogChemicalNameColumn = regexp.MustCompile(`(?i)(^|_)(chemical_)?names?($|_)`)

// The same immutable expression backs the import-time index and page seeks.
// Empty names use the source identity, as does the public title fallback.
func catalogNameExpression(kind, primary string, columns []CatalogColumn) (string, error) {
	quotedPrimary, err := pgColumn(primary)
	if err != nil {
		return "", err
	}
	value := func(column CatalogColumn) (string, error) {
		quoted, err := pgColumn(column.Column)
		if err != nil {
			return "", err
		}
		if strings.HasPrefix(column.Type, "set") {
			quoted += "[1]"
		}
		if kind == "chemicals" {
			quoted = "split_part(" + quoted + ",'=',1)"
		}
		return "COALESCE(NULLIF(btrim(" + quoted + "),''),'')", nil
	}
	parts := []string{}
	if kind == "species" {
		for _, rank := range []int{1, 0} {
			var selected *CatalogColumn
			for i := range columns {
				flags := strings.Fields(columns[i].Type)
				if !containsString(flags, fmt.Sprintf("clas[%d]", rank)) {
					continue
				}
				if selected == nil {
					selected = &columns[i]
				}
				if containsString(flags, "tag[default]") || containsString(flags, "tag[original]") {
					selected = &columns[i]
					break
				}
			}
			if selected != nil {
				part, err := value(*selected)
				if err != nil {
					return "", err
				}
				parts = append(parts, part)
			}
		}
	}
	name := "''"
	if len(parts) > 0 {
		name = "btrim(" + strings.Join(parts, " || ' ' || ") + ")"
	}
	var preferred *CatalogColumn
	if kind == "chemicals" {
		for i := range columns {
			column := &columns[i]
			if column.Column != primary && (catalogChemicalNameColumn.MatchString(column.Column) || strings.Contains(strings.ToLower(column.Name), "trivial name")) {
				preferred = column
				break
			}
		}
	}
	if preferred == nil {
		for i := range columns {
			if columns[i].Column != primary && catalogNameColumn.MatchString(columns[i].Column) {
				preferred = &columns[i]
				break
			}
		}
	}
	if preferred != nil {
		part, err := value(*preferred)
		if err != nil {
			return "", err
		}
		name = "COALESCE(NULLIF(" + name + ",'')," + part + ")"
	}
	return "lower(COALESCE(NULLIF(" + name + ",'')," + quotedPrimary + ")) COLLATE \"C\"", nil
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func (s *Store) pgCreateCatalogNameIndexes(catalog string) error {
	registry, err := pgTable(catalog)
	if err != nil {
		return err
	}
	rows, err := s.db.Query(`SELECT physical_table,entity_kind,primary_column,columns_json FROM ` + registry + ` WHERE name_order='name_v1'`)
	if err != nil {
		return err
	}
	defer rows.Close()
	statements := []string{}
	for rows.Next() {
		var physical, kind, primary, raw string
		if err = rows.Scan(&physical, &kind, &primary, &raw); err != nil {
			return err
		}
		columns, err := parseCatalogColumns(raw)
		if err != nil {
			return err
		}
		expression, err := catalogNameExpression(kind, primary, columns)
		if err != nil {
			return err
		}
		table, err := pgTable(physical)
		if err != nil {
			return err
		}
		key, err := pgColumn(primary)
		if err != nil {
			return err
		}
		statements = append(statements, `CREATE INDEX ON `+table+` ((`+expression+`),`+key+`)`)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, statement := range statements {
		if _, err = s.db.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}
