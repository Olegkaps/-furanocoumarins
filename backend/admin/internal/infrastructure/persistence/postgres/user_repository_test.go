package postgres_test

import (
	"context"
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"

	infrapostgres "admin/internal/infrastructure/persistence/postgres"
)

func TestUserRepositoryFindByLoginOrEmail(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	repo := infrapostgres.NewUserRepository(db)
	rows := sqlmock.NewRows([]string{"username", "email", "role", "hashed_password"}).
		AddRow("alice", "alice@example.com", "admin", "hash")

	mock.ExpectQuery("SELECT username, email, role, hashed_password FROM users").
		WithArgs("alice", "alice").
		WillReturnRows(rows)

	user, err := repo.FindByLoginOrEmail(context.Background(), "alice")
	require.NoError(t, err)
	require.Equal(t, "alice@example.com", user.Email)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestUserRepositoryFindByLoginOrEmailNotFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	repo := infrapostgres.NewUserRepository(db)
	mock.ExpectQuery("SELECT username, email, role, hashed_password FROM users").
		WithArgs("ghost", "ghost").
		WillReturnError(sql.ErrNoRows)

	_, err = repo.FindByLoginOrEmail(context.Background(), "ghost")
	require.ErrorIs(t, err, sql.ErrNoRows)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestUserRepositoryFindByLoginOrEmailQueryError(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	repo := infrapostgres.NewUserRepository(db)
	mock.ExpectQuery("SELECT username, email, role, hashed_password FROM users").
		WithArgs("alice", "alice").
		WillReturnError(sql.ErrConnDone)

	_, err = repo.FindByLoginOrEmail(context.Background(), "alice")
	require.ErrorIs(t, err, sql.ErrConnDone)
}

func TestUserRepositoryUpdatePassword(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	repo := infrapostgres.NewUserRepository(db)
	mock.ExpectExec("UPDATE users SET hashed_password").
		WithArgs("new-hash", "alice").
		WillReturnResult(sqlmock.NewResult(0, 1))

	err = repo.UpdatePassword(context.Background(), "alice", "new-hash")
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestUserRepositoryUpdatePasswordExecError(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	repo := infrapostgres.NewUserRepository(db)
	mock.ExpectExec("UPDATE users SET hashed_password").
		WithArgs("hash", "alice").
		WillReturnError(sql.ErrConnDone)

	err = repo.UpdatePassword(context.Background(), "alice", "hash")
	require.ErrorIs(t, err, sql.ErrConnDone)
}

func TestUserRepositoryExistsWithRole(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	repo := infrapostgres.NewUserRepository(db)
	rows := sqlmock.NewRows([]string{"exists"}).AddRow(true)
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("alice", "alice", "admin").
		WillReturnRows(rows)

	exists, err := repo.ExistsWithRole(context.Background(), "alice", "admin")
	require.NoError(t, err)
	require.True(t, exists)
}

func TestUserRepositoryExistsWithRoleFalse(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	repo := infrapostgres.NewUserRepository(db)
	rows := sqlmock.NewRows([]string{"exists"}).AddRow(false)
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("alice", "alice", "admin").
		WillReturnRows(rows)

	exists, err := repo.ExistsWithRole(context.Background(), "alice", "admin")
	require.NoError(t, err)
	require.False(t, exists)
}

func TestUserRepositoryExistsWithRoleQueryError(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	repo := infrapostgres.NewUserRepository(db)
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("alice", "alice", "admin").
		WillReturnError(sql.ErrConnDone)

	_, err = repo.ExistsWithRole(context.Background(), "alice", "admin")
	require.ErrorIs(t, err, sql.ErrConnDone)
}
