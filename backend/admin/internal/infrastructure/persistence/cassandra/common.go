package cassandra

import (
	"admin/internal/presentation/http/response"
	"fmt"
	"strings"

	"github.com/gocql/gocql"
)

func CreateSASIIndex(session *gocql.Session, table string, column string) error {
	if err := validateQualifiedIdentifier(table); err != nil {
		return err
	}
	if err := ValidateIdentifier(column); err != nil {
		return err
	}
	err := session.Query(fmt.Sprintf(
		`CREATE CUSTOM INDEX ON %s (%s)
		USING 'org.apache.cassandra.index.sasi.SASIIndex'
		WITH OPTIONS = {
			'analyzer_class': 'org.apache.cassandra.index.sasi.analyzer.StandardAnalyzer',
			'case_sensitive': 'false'
		};`,
		table,
		column,
	)).Exec()
	if err != nil {
		return &response.UserError{E: err}
	}
	return nil
}

func GetPrefix(session *gocql.Session, table string, column string, prefix string) ([]string, error) {
	query, err := cqlPrefixQuery(table, column)
	if err != nil {
		return nil, err
	}

	results := make(map[string]struct{}, 70)

	var v string
	iter := session.Query(query, prefix+"%").Iter()
	for iter.Scan(&v) {
		results[v] = struct{}{}
		if len(results) >= 50 {
			break
		}
	}

	if err := iter.Close(); err != nil {
		return nil, &response.UserError{E: err}
	}

	arr := make([]string, 0)
	for s := range results {
		arr = append(arr, s)
	}
	return arr, nil
}

func GetColumn(session *gocql.Session, table string, column string) ([]string, error) {
	if err := validateQualifiedIdentifier(table); err != nil {
		return nil, err
	}
	if err := ValidateIdentifier(column); err != nil {
		return nil, err
	}
	iter := session.Query(`
		SELECT ` + column + `
		FROM ` + table + `
		ALLOW FILTERING
	`).Iter()

	var values []string
	var v string
	for iter.Scan(&v) {
		values = append(values, v)
	}

	if err := iter.Close(); err != nil {
		return nil, &response.UserError{E: err}
	}

	return values, nil
}

func GetColumnWhere(session *gocql.Session, table string, column string, where string) ([]map[string]any, error) {
	query, args, err := cqlSelectWhereQuery(table, column, where)
	if err != nil {
		return nil, err
	}

	results := make([]map[string]any, 0)
	iter := session.Query(query, args...).Iter()

	row := make(map[string]interface{})

	for iter.MapScan(row) {
		results = append(results, row)
		row = make(map[string]interface{}) // from gocql doc
	}

	if err := iter.Close(); err != nil {
		return nil, &response.UserError{E: err}
	}

	return results, nil
}

func cqlPrefixQuery(table, column string) (string, error) {
	if err := validateQualifiedIdentifier(table); err != nil {
		return "", err
	}
	if err := ValidateIdentifier(column); err != nil {
		return "", err
	}
	return fmt.Sprintf("SELECT %s FROM %s WHERE %s LIKE ? LIMIT 1000", column, table, column), nil
}

func cqlSelectWhereQuery(table, selectClause, where string) (string, []any, error) {
	if err := validateQualifiedIdentifier(table); err != nil {
		return "", nil, err
	}
	cols := strings.Split(selectClause, ",")
	selected := make([]string, len(cols))
	for i, col := range cols {
		selected[i] = strings.TrimSpace(col)
		if err := ValidateIdentifier(selected[i]); err != nil {
			return "", nil, err
		}
	}
	condition, args, err := cqlWhere(where)
	if err != nil {
		return "", nil, err
	}
	return fmt.Sprintf("SELECT %s FROM %s WHERE %s ALLOW FILTERING", strings.Join(selected, ", "), table, condition), args, nil
}

func cqlWhere(raw string) (string, []any, error) {
	raw = strings.TrimSpace(raw)
	clauses := []string{}
	args := []any{}
	for {
		m := pgCondition.FindStringSubmatch(raw)
		if m == nil {
			return "", nil, fmt.Errorf("unsupported search expression")
		}
		if err := ValidateIdentifier(m[1]); err != nil {
			return "", nil, err
		}
		clauses = append(clauses, m[1]+" "+m[2]+" ?")
		args = append(args, strings.ReplaceAll(m[3], "''", "'"))
		raw = raw[len(m[0]):]
		if raw == "" {
			break
		}
		separator := pgConjunction.FindString(raw)
		if separator == "" {
			return "", nil, fmt.Errorf("unsupported search expression")
		}
		raw = raw[len(separator):]
	}
	return strings.Join(clauses, " AND "), args, nil
}
