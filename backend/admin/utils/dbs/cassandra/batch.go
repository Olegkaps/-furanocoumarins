package cassandra

import (
	"fmt"
	"strings"

	"github.com/gocql/gocql"
	_ "github.com/lib/pq"
)

func BatchInsertData(
	session *gocql.Session,
	tableName string,
	columns []string,
	data [][]any, // serialized_string or set or smth else
	batchSize int,
) error {

	batch := NewExecutor(session, batchSize)

	columnsStr := strings.Join(columns, ", ")
	placeholders := strings.Repeat("?, ", len(columns)-1) + "?"
	insertQuery := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", tableName, columnsStr, placeholders)

	for _, row := range data {
		if len(row) != len(columns) {
			return fmt.Errorf("different length of data rows in table %q: want %d, given %d", tableName, len(columns), len(row))
		}
		batch.Query(insertQuery, row...)
	}

	if err := batch.Execute(); err != nil {
		return fmt.Errorf("error in batch insert into %s: %w", tableName, err)
	}

	return nil
}

func CreateAndBatchInsertData(
	session *gocql.Session,
	tableName string,
	columnDefs []string, // col_name TYPE
	primaryKeys []string, // col_name
	data [][]any, // serialized_string or set or smth else
) error {
	var columns []string
	for _, col := range columnDefs {
		columns = append(columns, strings.Split(col, " ")[0])
	}

	primaryKeyClause := fmt.Sprintf("PRIMARY KEY (%s)", strings.Join(primaryKeys, ", "))
	createTableQuery := fmt.Sprintf(
		"CREATE TABLE IF NOT EXISTS %s (%s, %s) WITH caching = {'keys': 'ALL', 'rows_per_partition': 'ALL'};",
		tableName,
		strings.Join(columnDefs, ", "),
		primaryKeyClause,
	)

	if err := session.Query(createTableQuery).Exec(); err != nil {
		return fmt.Errorf("error while creating table %s: %w", tableName, err)
	}

	return BatchInsertData(session, tableName, columns, data, 50)
}
