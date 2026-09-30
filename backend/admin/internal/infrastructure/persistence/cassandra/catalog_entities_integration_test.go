//go:build integration

package cassandra

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gocql/gocql"
	"github.com/stretchr/testify/require"
)

func TestChemicalStereoisomersPinnedMetadataCountsOriginalIDsAndUnjoinedFamily(t *testing.T) {
	if os.Getenv("TEST_POSTGRES_DSN") == "" {
		t.Skip("requires explicit disposable TEST_POSTGRES_DSN")
	}
	db := postgresIntegrationDB(t)
	store := NewPostgresStore(db)
	require.NoError(t, store.EnsureActivationSchema(context.Background()))
	suffix := strings.ReplaceAll(gocql.TimeUUID().String(), "-", "")
	stamp := time.Now().UTC().Truncate(time.Microsecond)
	table := &Table{Timestamp: stamp, Name: "source family", Version: "v1", TableMeta: "chemdb.meta_" + suffix, TableData: "chemdb.data_" + suffix, TableSpecies: "chemdb.species_" + suffix}
	physical := SourceTableName(table.TableData, "structures")
	catalog := SourceCatalogName(table.TableData)
	for _, name := range []string{table.TableMeta, table.TableData, table.TableSpecies, physical, catalog} {
		name := name
		t.Cleanup(func() { _, err := db.Exec(`DROP TABLE IF EXISTS ` + mustPGTable(t, name)); require.NoError(t, err) })
	}
	document := `{"schema_version":2,"sheets":[{"name":"main","columns":[{"name":"chemical_id","data_type":"text","external_sheet":"structures"},{"name":"species_id","data_type":"text","external_sheet":"classification"},{"name":"refs","data_type":"set","reference":true}]},{"name":"structures","count_column":"family_id","columns":[{"name":"chemical_id","data_type":"text","primary_key":true},{"name":"family_id","data_type":"text"}]},{"name":"classification","count_column":"species_name","columns":[{"name":"species_id","data_type":"text","primary_key":true},{"name":"species_name","data_type":"text"}]},{"name":"publications","columns":[{"name":"unjoined_ref","data_type":"text","reference":true}]}]}`
	var metadataVersion int64
	require.NoError(t, db.QueryRow(`INSERT INTO chemdb.metadata_versions(document,created_by,provenance,published) VALUES($1,'test','test',true) RETURNING version`, document).Scan(&metadataVersion))
	t.Cleanup(func() {
		_, err := db.Exec(`DELETE FROM chemdb.tables WHERE created_at=$1`, stamp)
		require.NoError(t, err)
		_, err = db.Exec(`DELETE FROM chemdb.metadata_versions WHERE version=$1`, metadataVersion)
		require.NoError(t, err)
	})
	table.MetadataVersion = &metadataVersion
	reserved, err := store.pgReserveTable(table)
	require.NoError(t, err)
	require.True(t, reserved)
	require.NoError(t, store.pgCreateAndBatchInsert(table.TableMeta, []string{"column TEXT", "type TEXT", "description TEXT", "show_name TEXT"}, []string{"column"}, [][]any{}))
	require.NoError(t, store.pgCreateAndBatchInsert(table.TableData, []string{"observation_id TEXT", "chemical_id TEXT", "species_id TEXT", "species_name TEXT", "refs SET<TEXT>"}, []string{"observation_id"}, [][]any{
		{"o1", "c0", "s1", "Angelica", []string{"r1", "r2", "r2"}},
		{"o2", "c0", "s2", "Ruta", []string{"r1", "", "No Value"}},
		{"o3", "c0", "s2", "Ruta", []string{"r2"}},
		{"o4", "c1", "s3", "Ruta", []string{"r3", "r3"}},
		{"o5", "c1", "s4", "No Value", []string{"r4"}},
		{"o6", "c3", "", "", []string{}},
	}))
	require.NoError(t, store.pgCreateAndBatchInsert(table.TableSpecies, []string{"species_id TEXT", "species_name TEXT"}, []string{"species_id"}, [][]any{{"s1", "Angelica"}}))
	require.NoError(t, store.pgCreateAndBatchInsert(physical, []string{"chemical_id TEXT", "family_id TEXT", "name TEXT"}, []string{"chemical_id"}, [][]any{{"c0", "c0", "canonical"}, {"c1", "c0", "isomer"}, {"c2", "c0", "unjoined"}, {"c3", "c3", "other"}}))
	columns, err := json.Marshal([][]string{{"structures", "chemical_id", "primary", "", "ID"}, {"structures", "family_id", "text", "", "Family"}, {"structures", "name", "text", "", "Name"}})
	require.NoError(t, err)
	speciesColumns, err := json.Marshal([][]string{{"classification", "species_id", "primary", "", "ID"}, {"classification", "species_name", "text", "", "Species"}})
	require.NoError(t, err)
	require.NoError(t, store.pgCreateAndBatchInsert(catalog, []string{"virtual_name TEXT", "physical_table TEXT", "entity_kind TEXT", "primary_column TEXT", "columns_json TEXT", "name_order TEXT"}, []string{"virtual_name"}, [][]any{{"structures", physical, "chemicals", "chemical_id", string(columns), ""}, {"classification", table.TableSpecies, "species", "species_id", string(speciesColumns), ""}}))
	importer := &postgresImporter{store: store}
	require.NoError(t, importer.CreateSourceCountIndexes(table))
	require.NoError(t, importer.CreateSourceCountIndexes(table), "index creation is safe on import reruns")
	for _, name := range []string{table.TableData, physical, table.TableSpecies} {
		var indexes int
		require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM pg_indexes WHERE schemaname='chemdb' AND tablename=$1 AND indexname LIKE 'source_exact_%'`, strings.TrimPrefix(name, "chemdb.")).Scan(&indexes))
		require.Equal(t, 1, indexes, name)
	}
	require.NoError(t, store.pgSetTableOk(table))
	require.NoError(t, store.pgActivateTable(stamp))
	family, err := store.ChemicalStereoisomers(context.Background(), "c1")
	require.NoError(t, err)
	require.Equal(t, "c0", family.GroupValue)
	require.Equal(t, "family_id", family.CountColumn)
	require.Equal(t, "species_name", family.SpeciesCountColumn)
	require.Equal(t, []string{"refs"}, family.PublicationColumns)
	require.Len(t, family.Items, 3)
	require.Equal(t, Stereoisomer{ID: "c0", Item: map[string]any{"chemical_id": "c0", "family_id": "c0", "name": "canonical"}, SpeciesCount: 2, PublicationCount: 2, HasObservations: true}, family.Items[0])
	require.EqualValues(t, 1, family.Items[1].SpeciesCount)
	require.EqualValues(t, 2, family.Items[1].PublicationCount)
	require.Zero(t, family.Items[2].SpeciesCount)
	require.Zero(t, family.Items[2].PublicationCount)
	require.False(t, family.Items[2].HasObservations)
	blankCounts, err := store.ChemicalStereoisomers(context.Background(), "c3")
	require.NoError(t, err)
	require.True(t, blankCounts.Items[0].HasObservations, "observations exist even without species or references")
	require.Zero(t, blankCounts.Items[0].SpeciesCount)
	require.Zero(t, blankCounts.Items[0].PublicationCount)
	groups, err := store.SearchEntityGroups(context.Background(), stamp, []map[string]any{{"family_id": "c0"}, {"family_id": "c0"}})
	require.NoError(t, err)
	require.Equal(t, "c0", groups["chemical"].Items[0]["chemical_id"])
	require.Equal(t, "canonical", groups["chemical"].Items[0]["name"])
	_, err = db.Exec(`ALTER TABLE ` + mustPGTable(t, table.TableData) + ` DROP COLUMN chemical_id`)
	require.NoError(t, err)
	withoutJoinedID, err := store.ChemicalStereoisomers(context.Background(), "c1")
	require.NoError(t, err)
	require.Len(t, withoutJoinedID.Items, 3)
	for _, item := range withoutJoinedID.Items {
		require.Zero(t, item.SpeciesCount)
		require.Zero(t, item.PublicationCount)
	}
}
