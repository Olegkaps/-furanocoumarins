package cassandra

import (
	"admin/internal/pkg/searchquery"
	"errors"
	"github.com/lib/pq"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestSubstructureSQLPreservesBooleanAndBindsArray(t *testing.T) {
	raw := "(smiles SUBSTRUCTURE 'C' OR species = 'O''Brien') AND id != 'x'"
	sql, args, err := pgWhereResolved(raw, func(e *searchquery.Expression) (structureMatches, error) {
		require.Equal(t, "C", e.Value)
		return structureMatches{values: []string{"CC", "C' OR TRUE --"}}, nil
	})
	require.NoError(t, err)
	require.Equal(t, `("smiles" = ANY($1::text[]) OR "species" = $2) AND "id" != $3`, sql)
	require.Equal(t, "O'Brien", args[1])
	require.Equal(t, "x", args[2])
	actual, err := args[0].(*pq.StringArray).Value()
	require.NoError(t, err)
	require.Contains(t, actual, "C' OR TRUE --")
	_, _, err = pgWhere(raw)
	require.Error(t, err)
	failure := errors.New("busy")
	_, _, err = pgWhereResolved(raw, func(*searchquery.Expression) (structureMatches, error) { return structureMatches{}, failure })
	require.ErrorIs(t, err, failure)
}
