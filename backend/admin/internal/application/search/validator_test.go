package search_test

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"admin/internal/application/search"
	domainsearch "admin/internal/domain/search"
	"admin/internal/presentation/http/response"
)

func columnsFixture() []domainsearch.ColumnMeta {
	return []domainsearch.ColumnMeta{
		{Column: "name", Type: "primary text"},
		{Column: "surname", Type: "ref[]"},
		{Column: "second_name", Type: "set text"},
		{Column: "hidden_col", Type: "invisible text"},
	}
}

func TestValidateRequestPositive(t *testing.T) {
	columns := columnsFixture()
	assert.NoError(t, search.ValidateRequest("name = 'user'", columns))
	assert.NoError(t, search.ValidateRequest("name LIKE 'a%' AND surname LIKE 'x%'", columns))
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
	cols := []domainsearch.ColumnMeta{{Column: "x", Type: "invisible text"}}
	assert.Empty(t, search.VisibleColumns(cols))
}

func TestVisibleColumnsUsesExactInvisibleToken(t *testing.T) {
	cols := []domainsearch.ColumnMeta{
		{Column: "visible", Type: "uninvisible text"},
		{Column: "also_visible", Type: "link[https://example.test/invisible/%s] text"},
		{Column: "hidden", Type: "invisible text"},
		{Column: "invalid", Type: "link["},
	}
	assert.Equal(t, []string{"visible", "also_visible"}, search.VisibleColumns(cols))
}

func TestIsTypesEqualPositive(t *testing.T) {
	assert.True(t, search.IsTypesEqual("text primary", "text external[foo]"))
	assert.True(t, search.IsTypesEqual("text search chemical", "text search chemical"))
	assert.True(t, search.IsTypesEqual("clas[01][gbif] table_specie", "table_specie clas[01][gbif]"))
	assert.True(t, search.IsTypesEqual("link[https://example.test/%s] table_", "table_ link[https://example.test/%s]"))
	assert.True(t, search.IsTypesEqual("set[Bergapten Psoralen] chemical", "chemical set[Bergapten Psoralen]"))
	assert.True(t, search.IsTypesEqual("table_chemical SMILES", "table_chemical smiles"))
}

func TestIsTypesEqualNegative(t *testing.T) {
	assert.False(t, search.IsTypesEqual("text search", "text"))
	assert.False(t, search.IsTypesEqual("text chemical", "text specie"))
	assert.False(t, search.IsTypesEqual("clas[01][gbif]", "clas[01][original]"))
	assert.False(t, search.IsTypesEqual("link[https://one.test/%s]", "link[https://two.test/%s]"))
	assert.False(t, search.IsTypesEqual("set[one two]", "set[one three]"))
	assert.False(t, search.IsTypesEqual("external[sunset]", "set"))
	assert.False(t, search.IsTypesEqual("table_chemical SMILES", "table_chemical Smiles"))
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
		"name LIKE 'prefix%' AND second_name CONTAINS 'token'",
		"name = 'value' AND surname = 'ref'",
	}
	for _, query := range safe {
		t.Run(query, func(t *testing.T) {
			assert.NoError(t, search.ValidateRequest(query, columns))
		})
	}
}

func TestValidateRequestRejectsUnsupportedIN(t *testing.T) {
	err := search.ValidateRequest("name IN ('a', 'b')", columnsFixture())
	require.Error(t, err)
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
