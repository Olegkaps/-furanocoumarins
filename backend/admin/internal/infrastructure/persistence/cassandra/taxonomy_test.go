package cassandra

import (
	"testing"

	"admin/internal/pkg/metadata"
	"github.com/stretchr/testify/require"
)

func TestBuildTaxonSkipsEmptyIntermediateRanks(t *testing.T) {
	columns := []taxonomyColumn{
		{rank: 0, name: "species_original", label: "Species"},
		{rank: 1, name: "genus_original", label: "Genus"},
		{rank: 2, name: "tribe_original", label: "Tribe"},
		{rank: 3, name: "family_original", label: "Family"},
	}
	taxon := buildTaxon(columns, 3, "Apiaceae", [][]string{
		{"archangelica", "Angelica", "", "Apiaceae"},
		{"dahurica", "Angelica", "", "Apiaceae"},
		{"graveolens", "Anethum", "", "Apiaceae"},
	})
	require.Equal(t, "Apiaceae", taxon.Title)
	require.Equal(t, []TaxonLink{
		{Rank: 1, Name: "Anethum", SourceColumn: "Genus"},
		{Rank: 1, Name: "Angelica", SourceColumn: "Genus"},
	}, taxon.Children)

	species := buildTaxon(columns, 0, "archangelica", [][]string{{"archangelica", "Angelica", "", "Apiaceae"}})
	require.Equal(t, "Angelica archangelica", species.Title)
	require.Equal(t, &TaxonLink{Rank: 1, Name: "Angelica", SourceColumn: "Genus"}, species.Parent)
}

func TestEffectiveTaxonomyTagUsesOriginalAsTheDefault(t *testing.T) {
	require.Equal(t, "original", effectiveTaxonomyTag(""))
	require.Equal(t, "original", effectiveTaxonomyTag("default"))
	require.Equal(t, "original", effectiveTaxonomyTag("original"))
	require.Equal(t, "powo", effectiveTaxonomyTag("powo"))
}

func TestTaxonomyColumnsUsesPinnedClassificationSheetWithInferredSpeciesDomain(t *testing.T) {
	document := metadata.Document{Sheets: []metadata.Sheet{
		{Name: "classification", Columns: []metadata.Column{
			{Name: "species_original", Label: "Species", DataType: "text", Classification: &metadata.Classification{Level: 0}},
			{Name: "genus_original", Label: "Genus", DataType: "text", Classification: &metadata.Classification{Level: 1, Tag: "default"}},
			{Name: "powo_species", DataType: "text", Classification: &metadata.Classification{Level: 0, Tag: "powo"}},
		}},
		{Name: "main", Columns: []metadata.Column{{Name: "not_source_taxonomy", DataType: "text", Domain: "species", Classification: &metadata.Classification{Level: 2}}}},
	}}
	columns := taxonomyColumns(document)
	require.Equal(t, []taxonomyColumn{
		{rank: 0, index: 0, name: "species_original", label: "Species"},
		{rank: 1, index: 1, name: "genus_original", label: "Genus"},
	}, columns)
}
