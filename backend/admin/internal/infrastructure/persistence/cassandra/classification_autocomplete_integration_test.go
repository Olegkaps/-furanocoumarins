//go:build integration

package cassandra

import (
	"admin/internal/autocomplete"
	"context"
	"fmt"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
	"time"
)

func TestClassificationAutocompleteActualPairs(t *testing.T) {
	db := postgresIntegrationDB(t)
	store := NewPostgresStore(db)
	ctx := context.Background()
	suffix := fmt.Sprint(time.Now().UnixNano())
	data := "chemdb.class_data_" + suffix
	meta := "chemdb.class_meta_" + suffix
	t.Cleanup(func() {
		for _, name := range []string{data, meta} {
			_, err := db.Exec("DROP TABLE IF EXISTS " + mustPGTable(t, name))
			require.NoError(t, err)
		}
	})
	require.NoError(t, store.pgCreateAndBatchInsert(meta, []string{"column TEXT", "type TEXT", "show_name TEXT"}, []string{"column"}, [][]any{{"species", "search clas[0]", "Species"}, {"genus", "search clas[1] set", "Genus"}}))
	require.NoError(t, store.pgCreateAndBatchInsert(data, []string{"id TEXT", "species TEXT", "genus SET<TEXT>"}, []string{"id"}, [][]any{
		{"1", "archangelica", []string{"Angelica"}},
		{"2", "graveolens", []string{"Ruta"}},
		{"3", "Angelica sylvestris", []string{"Angelica"}},
		{"4", "archangelica", []string{"Angelica"}},
		{"5", "  o'brienii  ", []string{" Testus "}},
		{"6", "", []string{"Unknown"}},
		{"7", "lonely", []string{}},
		{"8", "graveolens", []string{"Angelica"}},
		{"10", "  ", []string{"Blankus"}},
		{"11", " heracleum ", []string{"Heracleum"}},
		{"12", "sphondylium", []string{"Heracleum"}},
	}))
	_, err := db.Exec("INSERT INTO " + mustPGTable(t, data) + " (id,genus) VALUES ('9',ARRAY['Nullus'])")
	require.NoError(t, err)
	entries, columns, err := store.autocompleteEntries(ctx, data, meta)
	require.NoError(t, err)
	require.Contains(t, columns, classificationAutocompleteColumn)
	index, err := autocomplete.New(ctx, entries, columns)
	require.NoError(t, err)
	defer index.Close()
	scoped, err := index.SearchColumns([]string{classificationAutocompleteColumn})
	require.NoError(t, err)
	require.Equal(t, []string{classificationAutocompleteColumn}, scoped)
	search := func(q string) []autocomplete.Suggestion {
		got, err := index.Search(ctx, q, scoped, 20)
		require.NoError(t, err)
		return got
	}
	got := search("ANGELCA archangelica")
	require.Len(t, got, 1)
	require.Equal(t, "Angelica archangelica", got[0].Value)
	require.Equal(t, []autocomplete.Condition{{Column: "species", Type: "search clas[0]", Value: "archangelica"}, {Column: "genus", Type: "search clas[1] set", Value: "Angelica"}}, got[0].Conditions)
	require.Empty(t, search("Ruta archangelica"))
	// The same epithet belongs to distinct genera. Each suggestion must retain
	// both source conditions, and those conditions must select its actual row.
	got = search("graveolens")
	require.Len(t, got, 2)
	for _, suggestion := range got {
		require.Len(t, suggestion.Conditions, 2)
		parts := make([]string, 0, 2)
		for _, condition := range suggestion.Conditions {
			operator := "="
			if strings.Contains(condition.Type, "set") {
				operator = "CONTAINS"
			}
			parts = append(parts, condition.Column+" "+operator+" '"+strings.ReplaceAll(condition.Value, "'", "''")+"'")
		}
		rows, err := store.pgSearchWhere(ctx, data, "id", strings.Join(parts, " AND "), nil)
		require.NoError(t, err)
		require.Len(t, rows, 1)
		expectedID := map[string]string{"Ruta graveolens": "2", "Angelica graveolens": "8"}[suggestion.Value]
		require.NotEmpty(t, expectedID)
		require.Equal(t, expectedID, rows[0]["id"])
	}
	for _, query := range []string{"Nullus", "Unknown", "Blankus", "lonely"} {
		require.Empty(t, search(query), "incomplete pairs must not generate suggestions")
	}
	got = search("Heracleum")
	require.Len(t, got, 1)
	require.Equal(t, "Heracleum sphondylium", got[0].Value)
	require.Len(t, got[0].Conditions, 2)
	// Bare genus searches remain available through the physical genus column.
	genera, err := index.Search(ctx, "Heracleum", []string{"genus"}, 20)
	require.NoError(t, err)
	require.Len(t, genera, 1)
	require.Equal(t, "Heracleum", genera[0].Value)
	got = search("sylvestris")
	require.Len(t, got, 1)
	require.Equal(t, "Angelica sylvestris", got[0].Value)
	got = search("Testus")
	require.Len(t, got, 1)
	require.Equal(t, "Testus o'brienii", got[0].Value)
	require.Len(t, got[0].Conditions, 2)
	require.Equal(t, " Testus ", got[0].Conditions[1].Value)
	require.Equal(t, "  o'brienii  ", got[0].Conditions[0].Value)
}
