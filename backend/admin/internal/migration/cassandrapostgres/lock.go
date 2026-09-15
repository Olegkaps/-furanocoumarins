package cassandrapostgres

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"time"
)

// Session advisory locks must remain on a reserved connection, not the pool
// used for copying tables. A contending migration fails without waiting.
func acquireMigrationLock(ctx context.Context, db *sql.DB) (func() error, error) {
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("reserve migration lock connection: %w", err)
	}
	closeConn := func(discard bool) error {
		if discard {
			// Returning ErrBadConn from Raw makes database/sql discard the
			// physical session rather than pool a possibly still-held lock.
			_ = conn.Raw(func(any) error { return driver.ErrBadConn })
		}
		err := conn.Close()
		if errors.Is(err, sql.ErrConnDone) {
			return nil
		}
		return err
	}
	var acquired bool
	if err := conn.QueryRowContext(ctx, "SELECT pg_try_advisory_lock(604260)").Scan(&acquired); err != nil {
		return nil, errors.Join(fmt.Errorf("acquire migration lock: %w", err), closeConn(true))
	}
	if !acquired {
		return nil, errors.Join(errors.New("another Cassandra migration holds the PostgreSQL lock"), closeConn(false))
	}
	return func() error {
		// Cleanup must work even after the migration context is cancelled.
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		var unlocked bool
		err := conn.QueryRowContext(cleanupCtx, "SELECT pg_advisory_unlock(604260)").Scan(&unlocked)
		if err == nil && !unlocked {
			err = errors.New("PostgreSQL migration lock was not held by its connection")
		}
		return errors.Join(err, closeConn(err != nil))
	}, nil
}
