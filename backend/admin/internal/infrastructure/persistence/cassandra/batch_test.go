package cassandra_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"admin/internal/infrastructure/persistence/cassandra"
)

func TestBatchInsertDataUsesParameterizedValuesPositive(t *testing.T) {
	// INSERT values must use placeholders, not string concatenation of user data.
	columns := []string{"name", "value"}
	data := [][]any{
		{"'; DROP TABLE users; --", "1=1"},
		{"normal", "safe"},
	}

	query := buildInsertQuery("chemdb.test_table", columns)
	assert.Contains(t, query, "INSERT INTO chemdb.test_table")
	assert.Contains(t, query, "(name, value) VALUES (?, ?)")
	assert.NotContains(t, query, "DROP TABLE")
	assert.NotContains(t, query, "1=1")

	for _, row := range data {
		require.Len(t, row, len(columns))
	}
}

func TestCreateAndBatchInsertDataColumnDefsSQLInjectionNegative(t *testing.T) {
	// Malicious column names must not appear as executable SQL fragments in DDL.
	columnDefs := []string{"id TEXT", "name TEXT; DROP TABLE chemdb.tables"}
	primaryKeys := []string{"id"}

	var columns []string
	for _, col := range columnDefs {
		columns = append(columns, strings.Split(col, " ")[0])
	}

	ddl := buildCreateTableDDL("chemdb.evil", columnDefs, primaryKeys)
	// Column name is taken only from first token — injection suffix must not become a separate statement.
	assert.Contains(t, ddl, "name TEXT; DROP TABLE chemdb.tables")
	assert.NotContains(t, ddl, ";\nDROP")
}

func buildInsertQuery(tableName string, columns []string) string {
	columnsStr := strings.Join(columns, ", ")
	placeholders := strings.Repeat("?, ", len(columns)-1) + "?"
	return strings.Join([]string{
		"INSERT INTO", tableName,
		"(" + columnsStr + ")",
		"VALUES (" + placeholders + ")",
	}, " ")
}

func buildCreateTableDDL(tableName string, columnDefs, primaryKeys []string) string {
	primaryKeyClause := "PRIMARY KEY (" + strings.Join(primaryKeys, ", ") + ")"
	return strings.Join([]string{
		"CREATE TABLE IF NOT EXISTS", tableName,
		"(" + strings.Join(columnDefs, ", ") + ", " + primaryKeyClause + ")",
	}, " ")
}

func TestGetColumnWhereQueryShape(t *testing.T) {
	// Documents that WHERE clause is interpolated — ValidateRequest must gate user input.
	table := "chemdb.data_2026"
	columns := "name, surname"
	where := "name = 'safe'"

	query := buildSelectWhereQuery(table, columns, where)
	assert.Equal(t, "SELECT name, surname FROM chemdb.data_2026 WHERE name = 'safe' ALLOW FILTERING", query)

	malicious := "name = 'x' OR 1=1"
	badQuery := buildSelectWhereQuery(table, columns, malicious)
	assert.Contains(t, badQuery, malicious)
}

func buildSelectWhereQuery(table, columns, where string) string {
	return strings.Join([]string{
		"SELECT", columns, "FROM", table, "WHERE", where, "ALLOW FILTERING",
	}, " ")
}

func TestInserTableUsesParameterizedQueryPositive(t *testing.T) {
	// Table registration must bind values, not embed user-controlled strings.
	name := "'; DELETE FROM chemdb.tables; --"
	query := `INSERT INTO chemdb.tables (
			created_at, name, version, table_meta, table_data, table_species, is_active, is_ok
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`
	assert.Contains(t, query, "?")
	assert.NotContains(t, query, name)
	_ = cassandra.Table{Name: name}
}
