//go:build integration

package cassandrapostgres

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestMigrationLockIntegrationSessionOwnership(t *testing.T) {
	dsn := os.Getenv("TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN must select a disposable test database")
	}
	db, err := sql.Open("postgres", dsn)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	db.SetMaxOpenConns(2)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	unlock, err := acquireMigrationLock(ctx, db)
	require.NoError(t, err)
	// Exercise the separate pooled session used by normal migration work.
	var answer int
	require.NoError(t, db.QueryRowContext(ctx, "SELECT 1").Scan(&answer))
	otherUnlock, err := acquireMigrationLock(ctx, db)
	require.ErrorContains(t, err, "another Cassandra migration")
	require.Nil(t, otherUnlock)
	cancel()
	require.NoError(t, unlock())
	ctx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	unlock, err = acquireMigrationLock(ctx, db)
	require.NoError(t, err, "lock must be reusable after cleanup")
	require.NoError(t, unlock())
}
