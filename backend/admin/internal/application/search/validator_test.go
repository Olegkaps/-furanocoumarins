package search_test

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"admin/internal/application/search"
	"admin/internal/infrastructure/persistence/cassandra"
	"admin/internal/presentation/http/response"
)

func columnsFixture() []*cassandra.ColumnMeta {
	return []*cassandra.ColumnMeta{
		{Column: "name", Type: "primary text"},
		{Column: "surname", Type: "ref[]"},
		{Column: "second_name", Type: "set text"},
		{Column: "hidden_col", Type: "invisible text"},
	}
}

func TestValidateRequestPositive(t *testing.T) {
	columns := columnsFixture()
	assert.NoError(t, search.ValidateRequest("name = 'user'", columns))
	assert.NoError(t, search.ValidateRequest("name IN ('a') AND surname LIKE 'x%'", columns))
}

func TestValidateRequestNegative(t *testing.T) {
	columns := columnsFixture()
	err := search.ValidateRequest("", columns)
	requireUserError(t, fmt.Errorf("search request is required"), err)

	err = search.ValidateRequest("name = 'user' AND role = 'admin'", columns)
	require.NotNil(t, err)
	userErr := err.(*response.UserError)
	assert.Contains(t, userErr.E.Error(), "role")
}

func TestVisibleColumnsPositive(t *testing.T) {
	assert.Equal(t, []string{"name", "surname", "second_name"}, search.VisibleColumns(columnsFixture()))
}

func TestVisibleColumnsNegativeAllInvisible(t *testing.T) {
	cols := []*cassandra.ColumnMeta{{Column: "x", Type: "invisible text"}}
	assert.Empty(t, search.VisibleColumns(cols))
}

func TestIsTypesEqualPositive(t *testing.T) {
	assert.True(t, search.IsTypesEqual("text primary", "text external[foo]"))
	assert.True(t, search.IsTypesEqual("text search chemical", "text search chemical"))
}

func TestIsTypesEqualNegative(t *testing.T) {
	assert.False(t, search.IsTypesEqual("text search", "text"))
	assert.False(t, search.IsTypesEqual("text chemical", "text specie"))
}

func TestValidateRequestSQLInjectionNegative(t *testing.T) {
	columns := columnsFixture()
	payloads := []string{
		"name = 'x' OR 1=1",
		"name = 'x'; DROP TABLE users; --",
		"1=1",
		"name UNION SELECT password FROM users",
		"name = 'a' AND surname CONTAINS 'b' OR true",
		"name LIKE '%' AND second_name = 'x' --",
		"'; DELETE FROM chemdb.tables; --",
		"name = 'x' AND EXEC xp_cmdshell('dir')",
		"name IN ('a') AND (SELECT COUNT(*) FROM users) > 0",
	}
	for _, payload := range payloads {
		t.Run(payload, func(t *testing.T) {
			err := search.ValidateRequest(payload, columns)
			require.NotNil(t, err, "payload must be rejected: %q", payload)
			_, ok := err.(*response.UserError)
			require.True(t, ok, "expected UserError for payload: %q", payload)
		})
	}
}

func TestValidateRequestSQLInjectionPositiveSafeQueries(t *testing.T) {
	columns := columnsFixture()
	safe := []string{
		"name = 'O''Brien'",
		"name IN ('a', 'b') AND surname != 'x'",
		"name LIKE 'prefix%' AND second_name CONTAINS 'token'",
		"name = 'value' AND surname = 'ref'",
	}
	for _, query := range safe {
		t.Run(query, func(t *testing.T) {
			assert.NoError(t, search.ValidateRequest(query, columns))
		})
	}
}

func TestIsTypesEqualSQLInjectionNegative(t *testing.T) {
	// Type strings with SQL fragments must not compare equal to legitimate types.
	assert.False(t, search.IsTypesEqual("text", "text; DROP TABLE users"))
	assert.False(t, search.IsTypesEqual("text search", "text' OR '1'='1"))
	assert.False(t, search.IsTypesEqual("primary text", "text UNION SELECT"))
}

func requireUserError(t *testing.T, expected error, actual error) {
	t.Helper()
	require.NotNil(t, actual)
	userErr, ok := actual.(*response.UserError)
	require.True(t, ok)
	assert.Equal(t, expected, userErr.E)
}
