package cassandra_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gocql/gocql"
	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/require"

	"admin/internal/infrastructure/persistence/cassandra"
)

func newFiberCtx(t *testing.T) *fiber.Ctx {
	t.Helper()
	app := fiber.New()
	var ctx *fiber.Ctx
	app.Get("/t", func(c *fiber.Ctx) error {
		ctx = c
		return nil
	})
	_, err := app.Test(httptest.NewRequest(http.MethodGet, "/t", nil))
	require.NoError(t, err)
	return ctx
}

func TestStoreGetArticleNotConfiguredNegative(t *testing.T) {
	store := cassandra.NewStore(nil)
	_, err := store.GetArticle("id")
	require.ErrorIs(t, err, cassandra.ErrNotConfigured)
}

func TestStoreGetAllTablesNotConfiguredNegative(t *testing.T) {
	store := cassandra.NewStore(nil)
	_, err := store.GetAllTables()
	require.ErrorIs(t, err, cassandra.ErrNotConfigured)
}

func TestStoreActivateTableNotConfiguredNegative(t *testing.T) {
	store := cassandra.NewStore(nil)
	err := store.ActivateTable(time.Now())
	require.ErrorIs(t, err, cassandra.ErrNotConfigured)
}

func TestStoreDeleteTableNotConfiguredNegative(t *testing.T) {
	store := cassandra.NewStore(nil)
	err := store.DeleteTable(newFiberCtx(t), time.Now())
	require.ErrorIs(t, err, cassandra.ErrNotConfigured)
}

func TestStoreDeleteAllBadTablesNotConfiguredNegative(t *testing.T) {
	store := cassandra.NewStore(nil)
	err := store.DeleteAllBadTables(newFiberCtx(t))
	require.ErrorIs(t, err, cassandra.ErrNotConfigured)
}

func TestStoreGetActiveTableNotConfiguredNegative(t *testing.T) {
	store := cassandra.NewStore(nil)
	_, err := store.GetActiveTable(newFiberCtx(t))
	require.ErrorIs(t, err, cassandra.ErrNotConfigured)
}

func TestStoreGetColumnMetaNotConfiguredNegative(t *testing.T) {
	store := cassandra.NewStore(nil)
	_, err := store.GetColumnMeta(newFiberCtx(t), &cassandra.Table{})
	require.ErrorIs(t, err, cassandra.ErrNotConfigured)
}

func TestStoreGetColumnWhereNotConfiguredNegative(t *testing.T) {
	store := cassandra.NewStore(nil)
	_, err := store.GetColumnWhere("t", "c", "w")
	require.ErrorIs(t, err, cassandra.ErrNotConfigured)
}

func TestStoreGetPrefixNotConfiguredNegative(t *testing.T) {
	store := cassandra.NewStore(nil)
	_, err := store.GetPrefix("t", "c", "p")
	require.ErrorIs(t, err, cassandra.ErrNotConfigured)
}

func TestStoreGetPageKeyNotConfiguredNegative(t *testing.T) {
	store := cassandra.NewStore(nil)
	_, err := store.GetPageKey("home")
	require.ErrorIs(t, err, cassandra.ErrNotConfigured)
}

func TestStoreSetPageKeyNotConfiguredNegative(t *testing.T) {
	store := cassandra.NewStore(nil)
	err := store.SetPageKey("home", "pages/home.md")
	require.ErrorIs(t, err, cassandra.ErrNotConfigured)
}

func TestStoreBatchInsertBibtexNotConfiguredNegative(t *testing.T) {
	store := cassandra.NewStore(nil)
	err := store.BatchInsertBibtex([][]any{{"a", "b"}})
	require.ErrorIs(t, err, cassandra.ErrNotConfigured)
}

func TestStoreGetColumnNotConfiguredNegative(t *testing.T) {
	store := cassandra.NewStore(nil)
	_, err := store.GetColumn("t", "c")
	require.ErrorIs(t, err, cassandra.ErrNotConfigured)
}

func TestStoreWithImporterNotConfiguredNegative(t *testing.T) {
	store := cassandra.NewStore(nil)
	err := store.WithImporter(func(_ cassandra.TableImporter) error { return nil })
	require.ErrorIs(t, err, cassandra.ErrNotConfigured)
}

func TestNewStorePositive(t *testing.T) {
	cluster := gocql.NewCluster("127.0.0.1")
	store := cassandra.NewStore(cluster)
	require.NotNil(t, store)
}
