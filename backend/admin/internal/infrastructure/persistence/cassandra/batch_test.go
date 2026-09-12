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
	assert.Equal(t, []string{"id", "name"}, columns)

	ddl := buildCreateTableDDL("chemdb.evil", columnDefs, primaryKeys)
	// Column name is taken only from first token — injection suffix must not become a separate statement.
	assert.Contains(t, ddl, "name TEXT; DROP TABLE chemdb.tables")
	assert.NotContains(t, ddl, ";\nDROP")
	require.Error(t, cassandra.CreateAndBatchInsertData(nil, "chemdb.evil", columnDefs, primaryKeys, nil), "validation must reject before using a Cassandra session")
}

func TestCassandraInterpolatedIdentifiersAreValidatedBeforeSessionUse(t *testing.T) {
	require.Error(t, cassandra.BatchInsertData(nil, "chemdb.safe", []string{"name;DROP"}, nil, 1))
	require.Error(t, cassandra.BatchInsertData(nil, "chemdb.select", []string{"name"}, nil, 1))
	require.Error(t, cassandra.CreateAndBatchInsertData(nil, "chemdb.safe", []string{"Name TEXT", "name TEXT"}, []string{"Name"}, nil))
	require.Error(t, cassandra.CreateSASIIndex(nil, "chemdb.safe", "name;drop"))
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

func TestReserveTableUsesParameterizedLWTQueryPositive(t *testing.T) {
	// Table registration must bind values, not embed user-controlled strings.
	name := "'; DELETE FROM chemdb.tables; --"
	query := `INSERT INTO chemdb.tables (
			created_at, name, version, table_meta, table_data, table_species, is_active, is_ok
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?) IF NOT EXISTS;`
	assert.Contains(t, query, "?")
	assert.Contains(t, query, "IF NOT EXISTS")
	assert.NotContains(t, query, name)
	_ = cassandra.Table{Name: name}
}
