package cassandra

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCQLSelectWhereQueryBindsQuotedValues(t *testing.T) {
	query, args, err := cqlSelectWhereQuery(
		"chemdb.data_2026",
		"name, aliases",
		"aliases CONTAINS 'O''Brien `backtick`' AND name = 'Coumarin`one'",
	)
	require.NoError(t, err)

	assert.Equal(t, "SELECT name, aliases FROM chemdb.data_2026 WHERE aliases CONTAINS ? AND name = ? ALLOW FILTERING", query)
	assert.Equal(t, []any{"O'Brien `backtick`", "Coumarin`one"}, args)
	assert.NotContains(t, query, "O'Brien")
	assert.NotContains(t, query, "`backtick`")
}

func TestCQLPrefixQueryBindsPrefixValue(t *testing.T) {
	query, err := cqlPrefixQuery("chemdb.data_2026", "name")
	require.NoError(t, err)

	assert.Equal(t, "SELECT name FROM chemdb.data_2026 WHERE name LIKE ? LIMIT 1000", query)
	assert.NotContains(t, query, "'")
	assert.NotContains(t, query, "`")
}

func TestCQLSelectWhereQueryRejectsUnsafeIdentifiers(t *testing.T) {
	_, _, err := cqlSelectWhereQuery("chemdb.data_2026", "name;DROP", "name = 'safe'")
	require.Error(t, err)

	_, _, err = cqlSelectWhereQuery("chemdb.data_2026", "name", "name;DROP = 'safe'")
	require.Error(t, err)
}
