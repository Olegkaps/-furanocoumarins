package cassandrapostgres

import (
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestMigrationLockReservesConnectionUntilCancelledContextCleanup(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	mock.ExpectQuery(`SELECT pg_try_advisory_lock\(604260\)`).WillReturnRows(sqlmock.NewRows([]string{"locked"}).AddRow(true))
	unlock, err := acquireMigrationLock(ctx, db)
	require.NoError(t, err)
	require.Equal(t, 1, db.Stats().InUse, "the owning session cannot return to the pool during migration")
	cancel()
	mock.ExpectQuery(`SELECT pg_advisory_unlock\(604260\)`).WillReturnRows(sqlmock.NewRows([]string{"unlocked"}).AddRow(true))
	require.NoError(t, unlock())
	require.Zero(t, db.Stats().InUse)
	mock.ExpectClose()
	require.NoError(t, db.Close())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestMigrationLockRejectsConcurrentMigration(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	mock.ExpectQuery(`SELECT pg_try_advisory_lock\(604260\)`).WillReturnRows(sqlmock.NewRows([]string{"locked"}).AddRow(false))
	unlock, err := acquireMigrationLock(context.Background(), db)
	require.ErrorContains(t, err, "another Cassandra migration")
	require.Nil(t, unlock)
	require.Zero(t, db.Stats().InUse)
	mock.ExpectClose()
	require.NoError(t, db.Close())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestMigrationLockDiscardsUncertainSession(t *testing.T) {
	for _, failure := range []string{"acquisition", "release query", "release false"} {
		t.Run(failure, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			acquire := mock.ExpectQuery(`SELECT pg_try_advisory_lock\(604260\)`)
			if failure == "acquisition" {
				acquire.WillReturnError(errors.New("connection interrupted"))
			} else {
				acquire.WillReturnRows(sqlmock.NewRows([]string{"locked"}).AddRow(true))
				release := mock.ExpectQuery(`SELECT pg_advisory_unlock\(604260\)`)
				if failure == "release query" {
					release.WillReturnError(errors.New("connection interrupted"))
				} else {
					release.WillReturnRows(sqlmock.NewRows([]string{"unlocked"}).AddRow(false))
				}
			}
			mock.ExpectClose() // discard must close the underlying driver session
			unlock, err := acquireMigrationLock(context.Background(), db)
			if failure == "acquisition" {
				require.Error(t, err)
				require.Nil(t, unlock)
			} else {
				require.NoError(t, err)
				require.Error(t, unlock())
			}
			require.Zero(t, db.Stats().OpenConnections)
			require.NoError(t, mock.ExpectationsWereMet())
			require.NoError(t, db.Close())
		})
	}
}
