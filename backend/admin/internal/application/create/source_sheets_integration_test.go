//go:build integration

package create_test

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	appcreate "admin/internal/application/create"
	"admin/internal/infrastructure/logging"
	"admin/internal/infrastructure/persistence/cassandra"
	"github.com/lib/pq"
	"github.com/stretchr/testify/require"
)

func TestPostgresImportPreservesSourceEntitiesAndCleansUp(t *testing.T) {
	dsn := os.Getenv("TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN required")
	}
	db, err := sql.Open("postgres", dsn)
	require.NoError(t, err)
	defer db.Close()
	store := cassandra.NewPostgresStore(db)
	require.NoError(t, store.EnsureActivationSchema(context.Background()))
	bibID := "source-test-" + time.Now().Format("150405.000000000")
	_, err = db.Exec("INSERT INTO chemdb.bibtex(article_id,bibtex_text) VALUES($1,$2)", bibID, "authoritative-publication")
	require.NoError(t, err)
	defer db.Exec("DELETE FROM chemdb.bibtex WHERE article_id=$1", bibID)
	f := sourceWorkbook(t)
	defer f.Close()
	// Reimporting the same workbook creates independent version-owned originals.
	for iteration := 0; iteration < 2; iteration++ {
		name := "source-integration-" + time.Now().Format("150405.000000000")
		_, err = appcreate.ImportTable(store, f, "meta", name, logging.Nop{})
		require.NoError(t, err)
		tables, err := store.GetAllTables()
		require.NoError(t, err)
		var table *cassandra.Table
		for _, candidate := range tables {
			if candidate.Name == name {
				table = candidate
				break
			}
		}
		require.NotNil(t, table)
		require.True(t, table.IsOk)
		catalog := cassandra.SourceCatalogName(table.TableData)
		quote := func(name string) string {
			return pq.QuoteIdentifier("chemdb") + "." + pq.QuoteIdentifier(name[len("chemdb."):])
		}
		rows, err := db.Query("SELECT virtual_name,physical_table,provenance FROM " + quote(catalog))
		require.NoError(t, err)
		physical := map[string]string{}
		for rows.Next() {
			var virtual, name, provenance string
			require.NoError(t, rows.Scan(&virtual, &name, &provenance))
			require.Equal(t, "workbook_postprocessed_unjoined", provenance)
			physical[virtual] = name
		}
		require.NoError(t, rows.Err())
		rows.Close()
		require.Len(t, physical, 4)
		var aliases pq.StringArray
		require.NoError(t, db.QueryRow("SELECT aliases FROM "+quote(physical["structures"])+" WHERE chemical_id='chem-unused'").Scan(&aliases))
		require.Equal(t, []string{"Unreferenced"}, []string(aliases))
		for virtual, count := range map[string]int{"structures": 2, "classification": 2, "publications": 1, "main": 1} {
			var actual int
			require.NoError(t, db.QueryRow("SELECT count(*) FROM "+quote(physical[virtual])).Scan(&actual))
			require.Equal(t, count, actual)
		}
		var linkedChemical string
		require.NoError(t, db.QueryRow("SELECT chemical_id FROM "+quote(physical["main"])).Scan(&linkedChemical))
		require.Equal(t, "chem-1", linkedChemical)
		var value string
		require.NoError(t, db.QueryRow("SELECT title FROM "+quote(physical["publications"])+" WHERE paper_id='paper-unused'").Scan(&value))
		require.Equal(t, "Unreferenced publication", value)
		require.NoError(t, db.QueryRow("SELECT species_name FROM "+quote(physical["classification"])+" WHERE species_id='sp-unused'").Scan(&value))
		require.Equal(t, "Unreferenced species", value)
		// Age only this isolated test record to exercise normal deletion policy.
		aged := table.Timestamp.Add(-10 * time.Minute)
		_, err = db.Exec("UPDATE chemdb.tables SET created_at=$1 WHERE created_at=$2", aged, table.Timestamp)
		require.NoError(t, err)
		// Catalog corruption must fail closed, never drop global publication data.
		_, err = db.Exec("UPDATE " + quote(catalog) + " SET physical_table='chemdb.bibtex' WHERE virtual_name='publications'")
		require.NoError(t, err)
		require.ErrorContains(t, store.DeleteTable(nil, aged), "invalid source table")
		var retained bool
		require.NoError(t, db.QueryRow("SELECT EXISTS(SELECT 1 FROM chemdb.tables WHERE created_at=$1)", aged).Scan(&retained))
		require.True(t, retained)
		_, err = db.Exec("UPDATE "+quote(catalog)+" SET physical_table=$1 WHERE virtual_name='publications'", physical["publications"])
		require.NoError(t, err)
		require.NoError(t, store.DeleteTable(nil, aged))
		for _, name := range append([]string{catalog, table.TableData, table.TableMeta}, physical["main"], physical["classification"], physical["structures"], physical["publications"]) {
			var exists bool
			require.NoError(t, db.QueryRow("SELECT to_regclass($1) IS NOT NULL", quote(name)).Scan(&exists))
			require.False(t, exists, name)
		}
		var bibtex string
		require.NoError(t, db.QueryRow("SELECT bibtex_text FROM chemdb.bibtex WHERE article_id=$1", bibID).Scan(&bibtex))
		require.Equal(t, "authoritative-publication", bibtex)
	}
}
