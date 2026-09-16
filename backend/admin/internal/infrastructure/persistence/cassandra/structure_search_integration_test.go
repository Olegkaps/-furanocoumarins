//go:build integration && rdkit

package cassandra

import (
	"admin/internal/chemistry"
	domainsearch "admin/internal/domain/search"
	"context"
	"fmt"
	"github.com/lib/pq"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
	"time"
)

func TestAutocompletePostgresStructureFullResults(t *testing.T) {
	db := postgresIntegrationDB(t)
	store := NewPostgresStore(db)
	ctx := context.Background()
	require.NoError(t, store.EnsureActivationSchema(ctx))
	t.Cleanup(func() { require.NoError(t, store.CloseAutocomplete()) })
	stamp := time.Now().UTC().Truncate(time.Microsecond)
	suffix := fmt.Sprint(stamp.UnixMicro())
	table := &Table{Timestamp: stamp, Name: "structure search integration", Version: "v2.0", TableMeta: "chemdb.structure_meta_" + suffix, TableData: "chemdb.structure_data_" + suffix, TableSpecies: "chemdb.structure_species_" + suffix}
	t.Cleanup(func() {
		_, err := db.Exec(`DELETE FROM chemdb.tables WHERE created_at=$1`, stamp)
		require.NoError(t, err)
		for _, n := range []string{table.TableData, table.TableMeta, table.TableSpecies} {
			_, err = db.Exec("DROP TABLE IF EXISTS " + mustPGTable(t, n))
			require.NoError(t, err)
		}
	})
	reserved, err := store.pgReserveTable(table)
	require.NoError(t, err)
	require.True(t, reserved)
	require.NoError(t, store.pgCreateAndBatchInsert(table.TableMeta, []string{"column TEXT", "type TEXT", "description TEXT", "show_name TEXT"}, []string{"column"}, [][]any{{"id", "text", "", "ID"}, {"smiles", "text SMILES", "", "Structure"}, {"species", "text search specie", "", "Species"}, {"structures", "set SMILES", "", "Structures"}}))
	data := [][]any{}
	for n := 1; n <= 140; n++ {
		for _, species := range []string{"a", "b"} {
			data = append(data, []any{fmt.Sprintf("%d%s", n, species), strings.Repeat("C", n), species, []string{strings.Repeat("C", n), "N"}})
		}
	}
	data = append(data, []any{"water", "O", "a", []string{}})
	require.NoError(t, store.pgCreateAndBatchInsert(table.TableData, []string{"id TEXT", "smiles TEXT", "species TEXT", "structures SET<TEXT>"}, []string{"id"}, data))
	_, err = db.Exec("INSERT INTO " + mustPGTable(t, table.TableData) + " (id,structures) VALUES ('null-structure',NULL)")
	require.NoError(t, err)
	require.NoError(t, store.pgCreateAndBatchInsert(table.TableSpecies, []string{"name TEXT"}, []string{"name"}, nil))
	require.NoError(t, store.pgSetTableOk(table))
	require.NoError(t, store.pgActivateTable(stamp))
	require.NoError(t, store.BuildStructureIndex(ctx))
	var originalRevision string
	var originalID int64
	require.NoError(t, db.QueryRow("SELECT revision FROM chemdb.structure_index_versions WHERE dataset=$1", table.TableData).Scan(&originalRevision))
	require.NoError(t, db.QueryRow("SELECT min(id) FROM chemdb.structure_candidates WHERE dataset=$1", table.TableData).Scan(&originalID))
	// New backend instances reuse persisted fingerprints; bibliography updates do not invalidate them.
	restarted := NewPostgresStore(db)
	_, err = db.Exec("UPDATE chemdb.autocomplete_generation SET generation=generation+1 WHERE id=1")
	require.NoError(t, err)
	require.NoError(t, restarted.BuildStructureIndex(ctx))
	var persistedID int64
	require.NoError(t, db.QueryRow("SELECT min(id) FROM chemdb.structure_candidates WHERE dataset=$1", table.TableData).Scan(&persistedID))
	require.Equal(t, originalID, persistedID)
	// A failed replacement leaves the previous complete generation intact.
	_, err = db.Exec("UPDATE chemdb.tables SET version=version||'-replacement' WHERE created_at=$1", stamp)
	require.NoError(t, err)
	_, err = db.Exec(`CREATE OR REPLACE FUNCTION chemdb.reject_structure_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced build failure'; END $$; CREATE TRIGGER reject_structure_test BEFORE INSERT ON chemdb.structure_candidates FOR EACH ROW EXECUTE FUNCTION chemdb.reject_structure_test()`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = db.Exec("DROP TRIGGER IF EXISTS reject_structure_test ON chemdb.structure_candidates; DROP FUNCTION IF EXISTS chemdb.reject_structure_test()")
	})
	require.ErrorContains(t, store.BuildStructureIndex(ctx), "forced build failure")
	_, err = db.Exec("DROP TRIGGER reject_structure_test ON chemdb.structure_candidates; DROP FUNCTION chemdb.reject_structure_test()")
	require.NoError(t, err)
	var afterFailure string
	require.NoError(t, db.QueryRow("SELECT revision FROM chemdb.structure_index_versions WHERE dataset=$1", table.TableData).Scan(&afterFailure))
	require.Equal(t, originalRevision, afterFailure)
	require.NoError(t, store.BuildStructureIndex(ctx))
	reader := NewSearchReader(restarted)
	version := domainsearch.TableVersion{Timestamp: stamp, Version: table.Version, TableData: table.TableData}
	for _, tc := range []struct {
		query string
		count int
	}{
		{"smiles SUBSTRUCTURE 'C'", 280},
		{"structures SUBSTRUCTURE 'C'", 280},
		{"structures SUBSTRUCTURE 'N'", 280},
		{"structures SUBSTRUCTURE 'O'", 0},
		{"structures SUBSTRUCTURE 'C' AND species = 'b'", 140},
		{"smiles SUBSTRUCTURE 'C' AND species = 'a'", 140},
		{"(smiles SUBSTRUCTURE 'C' AND species = 'b') OR id = 'water'", 141},
		{"smiles SUBSTRUCTURE 'N' OR id = 'water'", 1},
		{"smiles = 'CC'", 2},
		{"smiles SUBSTRUCTURE 'C1CCCCCCC1'", 0},
	} {
		rows, err := reader.FetchSearchData(nil, version, tc.query, "id,smiles,species")
		require.NoError(t, err, tc.query)
		require.Len(t, rows, tc.count, tc.query)
	}
	_, err = reader.FetchSearchData(nil, version, "smiles SUBSTRUCTURE 'C1bad'", "id")
	require.ErrorIs(t, err, chemistry.ErrInvalidSMILES)
	wrong := version
	wrong.TableData = "chemdb.not_active"
	_, err = reader.FetchSearchData(nil, wrong, "smiles SUBSTRUCTURE 'C'", "id")
	require.ErrorIs(t, err, chemistry.ErrBusy)
	// Exercise stronger features through persistent arrays, including asymmetric
	// relaxations: explicit oxygen/double bonds stay required in relaxed modes.
	featureValues := []string{"CO", "CN", "CCO", "C=C", "CC", "C=O", "C1=CC(=O)OC2=CC3=C(C=CO3)C=C21", "C1=CC2=C(C=CO2)C3=C1C=CC(=O)O3"}
	for n, smiles := range featureValues {
		_, err = db.Exec("INSERT INTO "+mustPGTable(t, table.TableData)+" (id,smiles,species,structures) VALUES ($1,$2,'feature',ARRAY[$2]::text[])", fmt.Sprintf("feature-%d", n), smiles)
		require.NoError(t, err)
	}
	_, err = db.Exec("UPDATE chemdb.tables SET version=version||'-features' WHERE created_at=$1", stamp)
	require.NoError(t, err)
	require.NoError(t, store.BuildStructureIndex(ctx))
	allValues := append([]string{}, featureValues...)
	allValues = append(allValues, "O")
	for n := 1; n <= 140; n++ {
		allValues = append(allValues, strings.Repeat("C", n))
	}
	reference, err := chemistry.NewIndex(allValues)
	require.NoError(t, err)
	defer reference.Close()
	for _, pattern := range []string{"CO", "C=C", "O[CH3]", featureValues[6], featureValues[7]} {
		for mode := 0; mode < 8; mode++ {
			opts := chemistry.Options{BondOrder: mode&1 != 0, AllowHeteroAtoms: mode&2 != 0, Stereochemistry: mode&4 != 0}
			expected, err := reference.Search(ctx, pattern, opts, 1000)
			require.NoError(t, err)
			actual, err := store.searchStructures(ctx, pattern, []string{"smiles"}, 1000, opts, false, table.TableData)
			require.NoError(t, err)
			values := []string{}
			for _, entry := range actual {
				values = append(values, entry.Value)
			}
			require.ElementsMatch(t, expected, values, "pattern=%s mode=%d", pattern, mode)
		}
	}
	for _, tc := range []struct {
		query, rejected string
		opts            chemistry.Options
	}{
		{"CO", "CN", chemistry.Options{AllowHeteroAtoms: true}},
		{"C=C", "CC", chemistry.Options{}},
	} {
		fp, err := chemistry.QueryFingerprint(ctx, tc.query, tc.opts)
		require.NoError(t, err)
		require.True(t, fp.Screenable)
		var admitted bool
		field := fmt.Sprintf("fp%d", chemistry.FingerprintMode(tc.opts))
		err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM chemdb.structure_candidates WHERE dataset=$1 AND column_name='smiles' AND smiles=$2 AND (NOT screenable OR "+field+" @> $3::integer[]))", table.TableData, tc.rejected, pq.Array(fp.Modes[chemistry.FingerprintMode(tc.opts)])).Scan(&admitted)
		require.NoError(t, err)
		require.False(t, admitted, "explicit constraint was lost: %s versus %s", tc.query, tc.rejected)
	}

	// Empty datasets still validate a SMILES pattern instead of silently accepting it.
	_, err = db.Exec("DELETE FROM " + mustPGTable(t, table.TableData))
	require.NoError(t, err)
	_, err = db.Exec(`UPDATE chemdb.tables SET version=version||'-changed' WHERE is_active`)
	require.NoError(t, err)
	_, err = reader.FetchSearchData(nil, version, "smiles SUBSTRUCTURE 'C1bad'", "id")
	require.ErrorIs(t, err, chemistry.ErrInvalidSMILES)
	require.NoError(t, store.BuildStructureIndex(ctx))
	rows, err := reader.FetchSearchData(nil, version, "smiles SUBSTRUCTURE 'C'", "id")
	require.NoError(t, err)
	require.Empty(t, rows)
}
