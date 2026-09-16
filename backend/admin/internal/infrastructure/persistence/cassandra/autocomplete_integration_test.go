//go:build integration

package cassandra

import (
	"context"
	"fmt"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

// Exercise the persisted generation trigger, not a mocked version counter: a
// second application replica must stop serving the old bibliography immediately.
func TestAutocompletePostgresBibliographyInvalidation(t *testing.T) {
	db := postgresIntegrationDB(t)
	store := NewPostgresStore(db)
	replica := NewPostgresStore(db)
	ctx := context.Background()
	t.Cleanup(func() { require.NoError(t, store.CloseAutocomplete()); require.NoError(t, replica.CloseAutocomplete()) })
	require.NoError(t, store.EnsureActivationSchema(ctx))
	stamp := time.Now().UTC().Truncate(time.Microsecond)
	suffix := fmt.Sprint(stamp.UnixMicro())
	table := &Table{Timestamp: stamp, Name: "autocomplete integration", Version: "v2.0", TableMeta: "chemdb.ac_meta_" + suffix, TableData: "chemdb.ac_data_" + suffix, TableSpecies: "chemdb.ac_species_" + suffix}
	ref := "ac_ref_" + suffix
	t.Cleanup(func() {
		_, err := db.Exec(`DELETE FROM chemdb.tables WHERE created_at=$1`, stamp)
		require.NoError(t, err)
		for _, name := range []string{table.TableMeta, table.TableData, table.TableSpecies} {
			_, err = db.Exec("DROP TABLE IF EXISTS " + mustPGTable(t, name))
			require.NoError(t, err)
		}
		_, err = db.Exec(`DELETE FROM chemdb.bibtex WHERE article_id=$1`, ref)
		require.NoError(t, err)
	})
	reserved, err := store.pgReserveTable(table)
	require.NoError(t, err)
	require.True(t, reserved)
	require.NoError(t, store.pgCreateAndBatchInsert(table.TableMeta, []string{"column TEXT", "type TEXT", "description TEXT", "show_name TEXT"}, []string{"column"}, [][]any{{"reference", "set ref[]", "", "Publication"}}))
	require.NoError(t, store.pgCreateAndBatchInsert(table.TableData, []string{"id TEXT", "reference SET<TEXT>"}, []string{"id"}, [][]any{{"one", []string{ref}}}))
	require.NoError(t, store.pgCreateAndBatchInsert(table.TableSpecies, []string{"name TEXT"}, []string{"name"}, nil))
	_, err = db.Exec(`INSERT INTO chemdb.bibtex(article_id,bibtex_text) VALUES($1,$2)`, ref, "@article{x,title={Phototoxic coumarins},author={Doe}} ")
	require.NoError(t, err)
	require.NoError(t, store.pgSetTableOk(table))
	require.NoError(t, store.pgActivateTable(stamp))
	for _, s := range []*Store{store, replica} {
		got, err := s.Autocomplete(ctx, "phototxic", []string{"reference"}, 20)
		require.NoError(t, err)
		require.Len(t, got, 1)
		require.Equal(t, ref, got[0].Value)
		require.Equal(t, "Publication", got[0].ShowName)
	}
	_, err = db.Exec(`UPDATE chemdb.bibtex SET bibtex_text=$2 WHERE article_id=$1`, ref, "@article{x,title={Botanical fluorescence},author={Doe}}")
	require.NoError(t, err)
	for _, s := range []*Store{store, replica} {
		old, err := s.Autocomplete(ctx, "phototoxic", []string{"reference"}, 20)
		require.NoError(t, err)
		require.Empty(t, old)
		fresh, err := s.Autocomplete(ctx, "fluorescenc", []string{"reference"}, 20)
		require.NoError(t, err)
		require.Len(t, fresh, 1)
		require.Equal(t, ref, fresh[0].Value)
	}
}
