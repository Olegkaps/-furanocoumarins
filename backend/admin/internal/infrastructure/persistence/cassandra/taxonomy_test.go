package cassandra

import (
	"context"
	"encoding/json"
	"regexp"
	"testing"

	"admin/internal/pkg/metadata"
	"github.com/DATA-DOG/go-sqlmock"
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

func TestTaxonomyCarriesSourceIDsForSpeciesLinks(t *testing.T) {
	columns := []taxonomyColumn{{rank: 0, name: "species", label: "Species"}, {rank: 1, name: "genus", label: "Genus"}}
	genus := buildTaxon(columns, 1, "Angelica", [][]string{{"archangelica", "Angelica", "species-1"}, {"dahurica", "Angelica", "species-2"}})
	require.Equal(t, []TaxonLink{{Rank: 0, Name: "archangelica", ID: "species-1", SourceColumn: "Species"}, {Rank: 0, Name: "dahurica", ID: "species-2", SourceColumn: "Species"}}, genus.Children)
	species := buildTaxon(columns, 0, "archangelica", [][]string{{"archangelica", "Angelica", "species-1"}})
	require.Equal(t, "species-1", species.ID)
}

func TestTaxonomySourceIDDisambiguatesMatchingEpithets(t *testing.T) {
	// The name is deliberately identical; source ID, not its accidental order,
	// selects the species row and therefore its genus/title.
	columns := []taxonomyColumn{{rank: 0, name: "species", label: "Species"}, {rank: 1, name: "genus", label: "Genus"}}
	rows := [][]string{{"communis", "Angelica", "species-angelica"}, {"communis", "Heracleum", "species-heracleum"}}
	matched := make([][]string, 0, 1)
	for _, row := range rows {
		if taxonomyMatches(row, 0, "", "species-heracleum", len(columns)) {
			matched = append(matched, row)
		}
	}
	taxon := buildTaxon(columns, 0, matched[0][0], matched)
	require.Equal(t, "Heracleum communis", taxon.Title)
	require.Equal(t, "species-heracleum", taxon.ID)
}

func TestTaxonomyIDUsesPrimaryKeyPredicate(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	document, err := json.Marshal(metadata.Document{Sheets: []metadata.Sheet{{Name: "classification", Columns: []metadata.Column{
		{Name: "species", DataType: "text", Classification: &metadata.Classification{Level: 0}},
		{Name: "genus", DataType: "text", Classification: &metadata.Classification{Level: 1}},
		{Name: "species_id", DataType: "text", PrimaryKey: true},
	}}}})
	require.NoError(t, err)
	physical := SourceTableName("chemdb.data_fixture", "classification")
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT t.table_species,t.table_data,m.document FROM chemdb.tables t JOIN chemdb.metadata_versions m ON m.version=t.metadata_version WHERE t.is_active AND t.is_ok`)).WillReturnRows(sqlmock.NewRows([]string{"table_species", "table_data", "document"}).AddRow("chemdb.species_fixture", "chemdb.data_fixture", document))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT to_regclass($1) IS NOT NULL`)).WithArgs(`"chemdb"."data_fixture_sources"`).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT physical_table,entity_kind,primary_column,columns_json FROM "chemdb"."data_fixture_sources" WHERE virtual_name=$1`)).WithArgs("classification").WillReturnRows(sqlmock.NewRows([]string{"physical_table", "entity_kind", "primary_column", "columns_json"}).AddRow(physical, "species", "source_id", `[["classification","source_id","primary","",""],["classification","species","clas[0]","",""],["classification","genus","clas[1]","",""]]`))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT "species","genus","source_id" FROM ` + mustPGTable(t, physical) + ` WHERE "source_id"=$1`)).WithArgs("species-heracleum").WillReturnRows(sqlmock.NewRows([]string{"species", "genus", "source_id"}).AddRow("communis", "Heracleum", "species-heracleum"))
	taxon, err := NewPostgresStore(db).Taxonomy(context.Background(), 0, "", "species-heracleum")
	require.NoError(t, err)
	require.Equal(t, "Heracleum communis", taxon.Title)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestTaxonomyNameRouteDoesNotRequireSourcePrimaryKeyColumn(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	document, err := json.Marshal(metadata.Document{Sheets: []metadata.Sheet{{Name: "classification", Columns: []metadata.Column{
		{Name: "species", DataType: "text", Classification: &metadata.Classification{Level: 0}},
		{Name: "genus", DataType: "text", Classification: &metadata.Classification{Level: 1}},
		{Name: "species_id", DataType: "text", PrimaryKey: true},
	}}}})
	require.NoError(t, err)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT t.table_species,t.table_data,m.document FROM chemdb.tables t JOIN chemdb.metadata_versions m ON m.version=t.metadata_version WHERE t.is_active AND t.is_ok`)).WillReturnRows(sqlmock.NewRows([]string{"table_species", "table_data", "document"}).AddRow("chemdb.species_fixture", "chemdb.data_fixture", document))
	// Legacy taxonomy tables may predate source catalogs and have no primary
	// source-ID column. Name pages must remain usable for those datasets.
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT "species","genus" FROM "chemdb"."species_fixture"`)).WillReturnRows(sqlmock.NewRows([]string{"species", "genus"}).AddRow("communis", "Heracleum"))
	taxon, err := NewPostgresStore(db).Taxonomy(context.Background(), 0, "communis", "")
	require.NoError(t, err)
	require.Equal(t, "Heracleum communis", taxon.Title)
	require.NoError(t, mock.ExpectationsWereMet())
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
