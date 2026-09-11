//go:build integration

package cassandrapostgres

import (
	"context"
	"database/sql"
	"os"
	"strconv"
	"testing"
	"time"

	"admin/internal/infrastructure/persistence/cassandra"
	"github.com/gocql/gocql"
	"github.com/lib/pq"
	"github.com/stretchr/testify/require"
)

// These explicit opt-in variables must point at isolated disposable databases.
func TestCassandraPostgresSourceCatalogMigration(t *testing.T) {
	host, dsn := os.Getenv("TEST_CASSANDRA_HOST"), os.Getenv("TEST_POSTGRES_DSN")
	if host == "" || dsn == "" {
		t.Skip("TEST_CASSANDRA_HOST and TEST_POSTGRES_DSN required")
	}
	cluster := gocql.NewCluster(host)
	if port := os.Getenv("TEST_CASSANDRA_PORT"); port != "" {
		var err error
		cluster.Port, err = strconv.Atoi(port)
		require.NoError(t, err)
	}
	cluster.Timeout = 30 * time.Second
	cluster.ConnectTimeout = 30 * time.Second
	session, err := cluster.CreateSession()
	require.NoError(t, err)
	t.Cleanup(session.Close)
	db, err := sql.Open("postgres", dsn)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	// The migrator's session-level advisory lock requires a pinned connection.
	db.SetMaxOpenConns(1)
	ctx := context.Background()
	require.NoError(t, session.Query("CREATE KEYSPACE IF NOT EXISTS chemdb WITH replication = {'class':'SimpleStrategy','replication_factor':1}").Exec())
	for _, q := range []string{
		"CREATE TABLE IF NOT EXISTS chemdb.tables(created_at timestamp PRIMARY KEY,name text,version text,table_meta text,table_data text,table_species text,is_ok boolean,is_active boolean)",
		"CREATE TABLE IF NOT EXISTS chemdb.bibtex(article_id text PRIMARY KEY,bibtex_text text)",
		"CREATE TABLE IF NOT EXISTS chemdb.pages(name text PRIMARY KEY,url text)",
	} {
		require.NoError(t, session.Query(q).Exec())
	}
	// Refuse unrelated data: this full-snapshot fixture must not migrate it.
	var registered int
	require.NoError(t, session.Query("SELECT count(*) FROM chemdb.tables").Scan(&registered))
	require.Zero(t, registered, "isolated Cassandra source required")
	prefix := "entity_T_" + strconv.FormatInt(time.Now().UnixNano(), 10)
	names := []string{}
	stamps := []time.Time{}
	t.Cleanup(func() {
		for _, stamp := range stamps {
			_ = session.Query("DELETE FROM chemdb.tables WHERE created_at=?", stamp).Exec()
			_, _ = db.Exec("DELETE FROM chemdb.tables WHERE created_at=$1", stamp)
		}
		for _, name := range names {
			_ = session.Query("DROP TABLE IF EXISTS " + name).Exec()
			q, _ := quotedQualified(name)
			_, _ = db.Exec("DROP TABLE IF EXISTS " + q)
			_, _ = db.Exec("DELETE FROM chemdb.cassandra_migrations WHERE table_name=$1", name)
		}
		_, _ = db.Exec("DELETE FROM chemdb.cassandra_migrations WHERE table_name IN ('chemdb.tables','chemdb.bibtex','chemdb.pages')")
	})
	var chemicals, dataWithCatalog string
	for i, withCatalog := range []bool{false, true} {
		data := "chemdb." + prefix + strconv.Itoa(i)
		meta, species := data+"_meta", data+"_species"
		for _, name := range []string{data, meta, species} {
			names = append(names, name)
			require.NoError(t, session.Query("CREATE TABLE "+name+"(id text PRIMARY KEY,value text)").Exec())
			require.NoError(t, session.Query("INSERT INTO "+name+"(id,value) VALUES(?,?)", "present", "original").Exec())
		}
		stamp := time.Now().UTC().Truncate(time.Millisecond).Add(time.Duration(i) * time.Second)
		stamps = append(stamps, stamp)
		require.NoError(t, session.Query("INSERT INTO chemdb.tables(created_at,name,version,table_meta,table_data,table_species,is_ok,is_active) VALUES(?,?,?,?,?,?,?,?)", stamp, prefix+strconv.Itoa(i), "v2", meta, data, species, true, false).Exec())
		found, err := discoverSourceTables(ctx, session, data, species)
		require.NoError(t, err)
		require.Empty(t, found)
		if !withCatalog {
			continue
		}
		dataWithCatalog = data
		catalog := cassandra.SourceCatalogName(data)
		chemicals = cassandra.SourceTableName(data, "structures")
		names = append(names, catalog, chemicals)
		require.NoError(t, session.Query("CREATE TABLE "+catalog+"(virtual_name text PRIMARY KEY,physical_table text,entity_kind text,primary_column text,source_sheet_names set<text>,columns_json text,provenance text)").Exec())
		require.NoError(t, session.Query("CREATE TABLE "+chemicals+"(chemical_id text PRIMARY KEY,aliases set<text>)").Exec())
		require.NoError(t, session.Query("INSERT INTO "+chemicals+"(chemical_id,aliases) VALUES(?,?)", "unreferenced", []string{"Bergapten", "Psoralen"}).Exec())
		require.NoError(t, session.Query("INSERT INTO "+catalog+"(virtual_name,physical_table,entity_kind,primary_column,source_sheet_names,columns_json,provenance) VALUES(?,?,?,?,?,?,?)", "structures", chemicals, "chemicals", "chemical_id", []string{"chemicals"}, `[["structures","aliases","set[<>]"]]`, "workbook_postprocessed_unjoined").Exec())
		found, err = discoverSourceTables(ctx, session, data, species)
		require.NoError(t, err)
		require.ElementsMatch(t, []string{catalog, chemicals}, found)
	}
	require.NoError(t, RunCassandraToPostgres(ctx, session, db))
	require.NoError(t, RunCassandraToPostgres(ctx, session, db), "identical rerun")
	var aliases pq.StringArray
	q, _ := quotedQualified(chemicals)
	require.NoError(t, db.QueryRow("SELECT aliases FROM "+q+" WHERE chemical_id='unreferenced'").Scan(&aliases))
	require.ElementsMatch(t, []string{"Bergapten", "Psoralen"}, []string(aliases))
	q, _ = quotedQualified(cassandra.SourceCatalogName(dataWithCatalog))
	var provenance string
	require.NoError(t, db.QueryRow("SELECT provenance FROM "+q).Scan(&provenance))
	require.Equal(t, "workbook_postprocessed_unjoined", provenance)
	require.NoError(t, session.Query("UPDATE "+chemicals+" SET aliases=? WHERE chemical_id=?", []string{"Changed"}, "unreferenced").Exec())
	require.ErrorContains(t, RunCassandraToPostgres(ctx, session, db), "conflicting completed migration")
	require.NoError(t, session.Query("UPDATE "+chemicals+" SET aliases=? WHERE chemical_id=?", []string{"Bergapten", "Psoralen"}, "unreferenced").Exec())
	require.NoError(t, session.Query("DROP TABLE "+cassandra.SourceCatalogName(dataWithCatalog)).Exec())
	require.ErrorContains(t, RunCassandraToPostgres(ctx, session, db), "source catalog disappeared")
}
