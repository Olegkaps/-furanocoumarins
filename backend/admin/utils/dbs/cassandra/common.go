package cassandra

import (
	"fmt"

	"github.com/gocql/gocql"
)

func CreateSASIIndex(session *gocql.Session, table string, column string) error {
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
		return err
	}
	return nil
}

func GetColumn(session *gocql.Session, table string, column string) ([]string, error) {
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
		return nil, err
	}

	return values, nil
}

func GetColumnWhere(session *gocql.Session, table string, column string, where string) ([]map[string]any, error) {
	Query := fmt.Sprintf(
		"SELECT %s FROM %s WHERE %s ALLOW FILTERING",
		column,
		table,
		where,
	)

	results := make([]map[string]any, 0)
	iter := session.Query(Query).Iter()

	row := make(map[string]interface{})

	for iter.MapScan(row) {
		results = append(results, row)
		row = make(map[string]interface{}) // from gocql doc
	}

	if err := iter.Close(); err != nil {
		return nil, err
	}

	return results, nil
}
