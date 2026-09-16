package cassandra

import (
	"admin/internal/autocomplete"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestClassificationAutocompletePairs(t *testing.T) {
	rank := func(name, typ string) autocomplete.Suggestion {
		return autocomplete.Suggestion{Column: name, Type: typ}
	}
	base := []autocomplete.Suggestion{rank("species", "search clas[0]"), rank("genus", "search clas[1]"), rank("accepted_species", "clas[0][powo]"), rank("accepted_genus", "clas[1][powo]")}
	require.Len(t, classificationAutocompletePairs(base), 1)
	for _, tc := range []struct {
		name    string
		columns []autocomplete.Suggestion
	}{
		{"missing", base[:1]},
		{"negative rank", []autocomplete.Suggestion{rank("bad", "search clas[-1]"), base[1]}},
		{"hidden", []autocomplete.Suggestion{base[0], rank("genus", "clas[1]")}},
		{"different tags", []autocomplete.Suggestion{base[0], rank("genus", "search clas[1][powo]")}},
		{"ambiguous", append(append([]autocomplete.Suggestion{}, base...), rank("other", "search clas[0]"))},
		{"reserved name", append(append([]autocomplete.Suggestion{}, base...), rank(classificationAutocompleteColumn, "search"))},
	} {
		t.Run(tc.name, func(t *testing.T) { require.Empty(t, classificationAutocompletePairs(tc.columns)) })
	}
	both := append(base, rank("powo_species", "search clas[0][powo]"), rank("powo_genus", "search clas[1][powo]"))
	require.Len(t, classificationAutocompletePairs(both), 2)
}
