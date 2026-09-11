package cassandra

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPostgresWhereBindsValuesAndQuotesColumns(t *testing.T) {
	where, args, err := pgWhere("species LIKE 'Angelica%' AND name = 'O''Brien'")
	require.NoError(t, err)
	assert.Equal(t, `"species" ILIKE $1 AND "name" = $2`, where)
	assert.Equal(t, []any{"Angelica%", "O'Brien"}, args)
	assert.NotContains(t, where, "Angelica")
	assert.NotContains(t, where, "Brien")
}

func TestPostgresWhereRejectsSQLInjection(t *testing.T) {
	_, _, err := pgWhere("species = 'x' OR 1=1")
	require.Error(t, err)
}

func TestPostgresWhereLikeUsesCaseInsensitivePostgresOperator(t *testing.T) {
	where, args, err := pgWhere("species LIKE 'aNgElIcA%'")
	require.NoError(t, err)
	assert.Equal(t, `"species" ILIKE $1`, where)
	assert.Equal(t, []any{"aNgElIcA%"}, args)
}

func TestPostgresWhereRejectsUnsupportedIN(t *testing.T) {
	_, _, err := pgWhere("species IN ('Angelica')")
	require.Error(t, err)
}

func TestPostgresContainsPreservesQuotedConjunctions(t *testing.T) {
	where, args, err := pgWhere("aliases CONTAINS 'O''Brien AND sons' AND species LIKE 'a AND b%'")
	require.NoError(t, err)
	assert.Equal(t, `"aliases" @> ARRAY[$1]::text[] AND "species" ILIKE $2`, where)
	assert.Equal(t, []any{"O'Brien AND sons", "a AND b%"}, args)
	for _, malformed := range []string{"", "aliases CONTAINS 'a' AND", "aliases CONTAINS 'a' AND ", "aliases CONTAINS 'a'b'", "aliases CONTAINS 'a' OR species = 'b'"} {
		_, _, err := pgWhere(malformed)
		require.Error(t, err, malformed)
	}
}

func TestPostgresSetValuesUseDriverArray(t *testing.T) {
	for _, value := range []any{[]string{"a"}, map[string]struct{}{"a": {}}} {
		array, err := postgresSetArray(value)
		require.NoError(t, err)
		assert.NotNil(t, array)
	}
	_, err := postgresSetArray("not-a-collection")
	require.Error(t, err)
}

func TestPostgresIdentifierRejectsSchemaInjection(t *testing.T) {
	_, err := pgTable(`chemdb.data;DROP TABLE users`)
	require.Error(t, err)
}
