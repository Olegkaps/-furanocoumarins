package metadata

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestChemicalNameList(t *testing.T) {
	require.True(t, IsChemicalNameList("names", "search table_2 chemical"))
	for _, pair := range [][2]string{{"names", "specie"}, {"formula", "chemical"}, {"names", "set chemical"}, {"names", "set[a b] chemical"}} {
		require.False(t, IsChemicalNameList(pair[0], pair[1]))
	}
	require.Equal(t, []string{"Byakangelicin", "5-O-Methyl heraclenol, (+),2''R"}, ChemicalNames(" Byakangelicin =5-O-Methyl heraclenol, (+),2''R=Byakangelicin== "))
	require.Empty(t, ChemicalNames(" = = "))
}
