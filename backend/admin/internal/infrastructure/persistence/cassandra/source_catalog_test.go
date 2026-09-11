package cassandra

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSourceCatalogOwnershipAndIdentifierBounds(t *testing.T) {
	data, species := "chemdb.data_2026T12", "chemdb.species_2026T12"
	require.Equal(t, data+"_sources", SourceCatalogName(data))
	require.NoError(t, ValidateSourceTable(data, species, "classification", species))
	require.NoError(t, ValidateSourceTable(data, species, "structures", SourceTableName(data, "structures")))
	for _, physical := range []string{"chemdb.bibtex", SourceTableName("chemdb.other", "structures"), "chemdb.species_other"} {
		require.Error(t, ValidateSourceTable(data, species, "structures", physical))
		require.Error(t, ValidateSourceTable(data, species, "classification", physical))
	}
	long := "chemdb." + strings.Repeat("d", 200)
	for _, name := range []string{SourceCatalogName(long), SourceTableName(long, strings.Repeat("v", 200))} {
		_, err := pgTable(name)
		require.NoError(t, err)
		require.LessOrEqual(t, len(strings.Split(name, ".")[1]), 63)
	}
	require.NotEqual(t, SourceTableName(data, "a"), SourceTableName(data, "b"))
}
