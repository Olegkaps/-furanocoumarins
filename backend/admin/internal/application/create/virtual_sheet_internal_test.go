package create

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestColumnModifierTokenAliases(t *testing.T) {
	species := columnModifiers{tokens: map[string]struct{}{"table_specie": {}}}
	assert.True(t, species.hasToken("table_"))
	assert.True(t, species.hasToken("specie"))
	assert.False(t, species.hasToken("chemical"))

	chemical := columnModifiers{tokens: map[string]struct{}{"table_chemical": {}}}
	assert.True(t, chemical.hasToken("table_"))
	assert.True(t, chemical.hasToken("chemical"))
	assert.False(t, chemical.hasToken("specie"))
	assert.False(t, chemical.hasToken("missing"))
}

func TestEqualColumnTypesReportsEitherParseError(t *testing.T) {
	_, err := equalColumnTypes("link[", "text")
	require.Error(t, err)
	_, err = equalColumnTypes("text", "link[")
	require.Error(t, err)
}

func TestValidateUniqueColumnDefinitionsRejectsMalformedShape(t *testing.T) {
	err := validateUniqueColumnDefinitions("data", []string{"missing-type"})
	require.ErrorContains(t, err, "column definition")
}

func TestValidateUniqueColumnDefinitionsEnforcesIdentifiersAndUniqueness(t *testing.T) {
	require.NoError(t, validateUniqueColumnDefinitions("data", []string{"id TEXT", "name SET<TEXT>"}))
	require.Error(t, validateUniqueColumnDefinitions("data", []string{"bad-name TEXT"}))
	require.ErrorContains(t, validateUniqueColumnDefinitions("data", []string{"Name TEXT", "name TEXT"}), "duplicate")
}

func TestParseTypeArgumentRequiresOpeningBracket(t *testing.T) {
	_, _, err := parseTypeArgument("not-bracketed", 0, "link")
	require.ErrorContains(t, err, "malformed link")
}

func TestCanonicalColumnTypeToken(t *testing.T) {
	assert.Equal(t, "SMILES", canonicalColumnTypeToken("smiles"))
	assert.Equal(t, "text", canonicalColumnTypeToken("text"))
}
