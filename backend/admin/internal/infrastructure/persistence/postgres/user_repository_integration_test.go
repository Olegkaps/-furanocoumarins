//go:build integration

package postgres_test

import (
	"context"
	"database/sql"
	"os"
	"testing"

	_ "github.com/lib/pq"
	"github.com/stretchr/testify/require"

	infrapostgres "admin/internal/infrastructure/persistence/postgres"
	"admin/internal/infrastructure/security"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("TEST_POSTGRES_DSN")
	if dsn == "" {
		dsn = "user=postgres password=postgres dbname=postgres host=127.0.0.1 port=5432 sslmode=disable"
	}

	db, err := sql.Open("postgres", dsn)
	require.NoError(t, err)
	require.NoError(t, db.PingContext(context.Background()))

	_, err = db.ExecContext(context.Background(), `
		CREATE TABLE IF NOT EXISTS users (
			username TEXT PRIMARY KEY,
			email TEXT UNIQUE NOT NULL,
			role TEXT NOT NULL,
			hashed_password TEXT NOT NULL
		)
	`)
	require.NoError(t, err)

	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), "DELETE FROM users WHERE username LIKE 'test_%'")
		_ = db.Close()
	})

	return db
}

func TestUserRepositoryIntegration(t *testing.T) {
	db := openTestDB(t)
	repo := infrapostgres.NewUserRepository(db)
	ctx := context.Background()

	hasher := security.PasswordHasher{}
	hash, err := hasher.Hash("integration-secret")
	require.NoError(t, err)

	_, err = db.ExecContext(ctx,
		`INSERT INTO users (username, email, role, hashed_password)
		 VALUES ('test_user', 'test_user@example.com', 'admin', $1)
		 ON CONFLICT (username) DO UPDATE SET hashed_password = EXCLUDED.hashed_password`,
		hash,
	)
	require.NoError(t, err)

	user, err := repo.FindByLoginOrEmail(ctx, "test_user@example.com")
	require.NoError(t, err)
	require.Equal(t, "test_user", user.Username)
	require.True(t, user.CanAuthenticateWith("integration-secret", hasher.Verify))

	exists, err := repo.ExistsWithRole(ctx, "test_user", "admin")
	require.NoError(t, err)
	require.True(t, exists)

	newHash, err := hasher.Hash("new-secret")
	require.NoError(t, err)
	require.NoError(t, repo.UpdatePassword(ctx, "test_user", newHash))

	user, err = repo.FindByLoginOrEmail(ctx, "test_user")
	require.NoError(t, err)
	require.True(t, user.CanAuthenticateWith("new-secret", hasher.Verify))
}
