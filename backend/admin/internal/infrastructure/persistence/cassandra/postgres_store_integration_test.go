//go:build integration

package cassandra

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"admin/internal/presentation/http/response"

	"github.com/gocql/gocql"
	"github.com/gofiber/fiber/v2"
	_ "github.com/lib/pq"
	"github.com/stretchr/testify/require"
)

func postgresIntegrationDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("TEST_POSTGRES_DSN")
	if dsn == "" {
		dsn = "user=postgres password=postgres dbname=postgres host=127.0.0.1 port=5432 sslmode=disable"
	}
	db, err := sql.Open("postgres", dsn)
	require.NoError(t, err)
	require.NoError(t, db.PingContext(context.Background()))
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}

func integrationFiberCtx(t *testing.T) *fiber.Ctx {
	t.Helper()
	app := fiber.New()
	var result *fiber.Ctx
	app.Get("/", func(c *fiber.Ctx) error { result = c; return nil })
	_, err := app.Test(httptest.NewRequest(http.MethodGet, "/", nil))
	require.NoError(t, err)
	return result
}

func TestPostgresStoreIntegrationImportSearchActivationAndDeletion(t *testing.T) {
	db := postgresIntegrationDB(t)
	store := NewPostgresStore(db)
	ctx := context.Background()
	require.NoError(t, store.EnsureActivationSchema(ctx))
	stamp := time.Now().UTC().Add(-10 * time.Minute).Truncate(time.Microsecond)
	suffix := stamp.Format("20060102150405123456")
	table := &Table{Timestamp: stamp, Name: "integration", Version: "v1", TableMeta: "chemdb.meta_" + suffix, TableData: "chemdb.data_" + suffix, TableSpecies: "chemdb.species_" + suffix}
	for _, name := range []string{table.TableMeta, table.TableData, table.TableSpecies} {
		t.Cleanup(func() { _, err := db.Exec("DROP TABLE IF EXISTS " + mustPGTable(t, name)); require.NoError(t, err) })
	}
	t.Cleanup(func() {
		_, err := db.Exec(`DELETE FROM chemdb.tables WHERE created_at=$1`, stamp)
		require.NoError(t, err)
	})
	reserved, err := store.pgReserveTable(table)
	require.NoError(t, err)
	require.True(t, reserved)
	require.NoError(t, store.pgCreateAndBatchInsert(table.TableMeta, []string{"column TEXT", "type TEXT", "description TEXT", "show_name TEXT"}, []string{"column"}, [][]any{{"species", "text", "", "Species"}}))
	id := gocql.TimeUUID().String()
	require.NoError(t, store.pgCreateAndBatchInsert(table.TableData, []string{"id UUID", "species TEXT", "aliases SET<TEXT>"}, []string{"id"}, [][]any{{id, "Angelica archangelica", []string{"Angelica", "Archangelica"}}}))
	require.NoError(t, store.pgCreateAndBatchInsert(table.TableSpecies, []string{"name TEXT"}, []string{"name"}, [][]any{{"Angelica archangelica"}}))
	require.NoError(t, store.pgSetTableOk(table))
	require.NoError(t, store.pgActivateTable(stamp))
	active, err := store.pgGetActiveTable(integrationFiberCtx(t))
	require.NoError(t, err)
	require.True(t, stamp.Equal(active.Timestamp))
	rows, err := store.pgGetColumnWhere(table.TableData, "species", "species LIKE 'angelica%'")
	require.NoError(t, err)
	require.Len(t, rows, 1)
	prefixes, err := store.pgGetPrefix(table.TableData, "species", "angelica")
	require.NoError(t, err)
	require.Equal(t, []string{"Angelica archangelica"}, prefixes)
	// A newer active table permits deletion of the previous dynamic workbook.
	newer := &Table{Timestamp: stamp.Add(time.Microsecond), Name: "newer", Version: "v1", TableMeta: "chemdb.meta_newer_" + suffix, TableData: "chemdb.data_newer_" + suffix, TableSpecies: "chemdb.species_newer_" + suffix}
	for _, name := range []string{newer.TableMeta, newer.TableData, newer.TableSpecies} {
		t.Cleanup(func() { _, err := db.Exec("DROP TABLE IF EXISTS " + mustPGTable(t, name)); require.NoError(t, err) })
	}
	t.Cleanup(func() {
		_, err := db.Exec(`DELETE FROM chemdb.tables WHERE created_at=$1`, newer.Timestamp)
		require.NoError(t, err)
	})
	reserved, err = store.pgReserveTable(newer)
	require.NoError(t, err)
	require.True(t, reserved)
	for _, name := range []string{newer.TableMeta, newer.TableData, newer.TableSpecies} {
		require.NoError(t, store.pgCreateAndBatchInsert(name, []string{"id TEXT"}, []string{"id"}, [][]any{}))
	}
	require.NoError(t, store.pgSetTableOk(newer))
	var userError *response.UserError
	require.ErrorAs(t, store.pgActivateTable(stamp.Add(24*time.Hour)), &userError)
	// Both valid requests must succeed regardless of lock acquisition order.
	results := make(chan error, 2)
	start := make(chan struct{})
	for _, candidate := range []time.Time{stamp, newer.Timestamp} {
		go func(ts time.Time) { <-start; results <- store.pgActivateTable(ts) }(candidate)
	}
	close(start)
	require.NoError(t, <-results)
	require.NoError(t, <-results)
	var activeCount int
	require.NoError(t, db.QueryRow(`SELECT count(*) FROM chemdb.tables WHERE is_active`).Scan(&activeCount))
	require.Equal(t, 1, activeCount)
	require.NoError(t, store.pgActivateTable(newer.Timestamp))
	require.NoError(t, store.pgDeleteTable(integrationFiberCtx(t), stamp))
	var exists bool
	require.NoError(t, db.QueryRow(`SELECT to_regclass($1) IS NOT NULL`, table.TableData).Scan(&exists))
	require.False(t, exists)
}

func mustPGTable(t *testing.T, name string) string {
	t.Helper()
	value, err := pgTable(name)
	require.NoError(t, err)
	return value
}

func TestPostgresStoreIntegrationContainsAndArrayResults(t *testing.T) {
	db := postgresIntegrationDB(t)
	store := NewPostgresStore(db)
	require.NoError(t, store.EnsureActivationSchema(context.Background()))
	table := "chemdb.contains_" + strings.ReplaceAll(gocql.TimeUUID().String(), "-", "")
	t.Cleanup(func() { _, err := db.Exec("DROP TABLE IF EXISTS " + mustPGTable(t, table)); require.NoError(t, err) })
	items := []string{"Angelica", "O'Brien AND sons", "comma,value", `quote"value`, `slash\value`}
	require.NoError(t, store.pgCreateAndBatchInsert(table, []string{"id TEXT", "aliases SET<TEXT>"}, []string{"id"}, [][]any{{"match", items}, {"empty", []string{}}, {"other", []string{"Angelica extra"}}}))
	require.NoError(t, store.pgCreateSearchIndex(table, "aliases"))
	require.NoError(t, store.pgCreateSearchIndex(table, "aliases"))
	var indexCount int
	require.NoError(t, db.QueryRow(`SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am a ON a.oid=c.relam WHERE i.indrelid=$1::regclass AND a.amname='gin' AND pg_get_indexdef(i.indexrelid) LIKE '%(aliases)%'`, table).Scan(&indexCount))
	require.Equal(t, 1, indexCount)
	for _, test := range []struct {
		query string
		count int
	}{
		{"aliases CONTAINS 'Angelica'", 1},
		{"aliases CONTAINS 'angelica'", 0},
		{"aliases CONTAINS 'Angel'", 0},
		{"aliases CONTAINS 'O''Brien AND sons' AND id = 'match'", 1},
	} {
		rows, err := store.pgGetColumnWhere(table, "id,aliases", test.query)
		require.NoError(t, err, test.query)
		require.Len(t, rows, test.count, test.query)
		if test.count == 1 {
			require.Equal(t, "match", rows[0]["id"])
			require.Equal(t, items, rows[0]["aliases"])
			encoded, err := json.Marshal(rows[0]["aliases"])
			require.NoError(t, err)
			var decoded []string
			require.NoError(t, json.Unmarshal(encoded, &decoded))
			require.Equal(t, items, decoded)
		}
	}
	rows, err := store.pgGetColumnWhere(table, "aliases", "id = 'empty'")
	require.NoError(t, err)
	require.Equal(t, []string{}, rows[0]["aliases"])
}
