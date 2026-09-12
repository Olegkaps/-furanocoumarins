// Package cassandrapostgres contains the offline-only cutover protocol.  It is
// intentionally not referenced by the HTTP container: Cassandra is a source,
// never a runtime fallback.
package cassandrapostgres

import (
	"context"
	"errors"
	"fmt"
)

type Table struct {
	ID, Meta, Data, Species, Checksum string
	Active                            bool
	Rows                              int64
}

// Source implementations must read a quiesced legacy keyspace only.
type Source interface {
	Tables(context.Context) ([]Table, error)
	CopyTable(context.Context, Table) error
	CopyBibtex(context.Context) error
	CopyPages(context.Context) error
}

// Target implementations hold a PostgreSQL advisory lock and persist a manifest.
type Target interface {
	Lock(context.Context) (func() error, error)
	Manifest(context.Context, string) (Table, bool, error)
	PutManifest(context.Context, Table) error
	SetActive(context.Context, string) error
	Validate(context.Context, Table) error
}

func Run(ctx context.Context, source Source, target Target) (resultErr error) {
	unlock, err := target.Lock(ctx)
	if err != nil {
		return fmt.Errorf("acquire PostgreSQL migration lock: %w", err)
	}
	defer func() {
		if err := unlock(); err != nil {
			resultErr = errors.Join(resultErr, fmt.Errorf("release PostgreSQL migration lock: %w", err))
		}
	}()
	tables, err := source.Tables(ctx)
	if err != nil {
		return fmt.Errorf("read Cassandra registry: %w", err)
	}
	active := ""
	for _, table := range tables {
		if table.ID == "" || table.Checksum == "" {
			return fmt.Errorf("legacy table has no stable id/checksum")
		}
		old, exists, err := target.Manifest(ctx, table.ID)
		if err != nil {
			return err
		}
		if exists {
			if old.Checksum != table.Checksum || old.Rows != table.Rows {
				return fmt.Errorf("conflicting completed migration for %s", table.ID)
			}
		} else {
			if err := source.CopyTable(ctx, table); err != nil {
				return fmt.Errorf("copy %s: %w", table.ID, err)
			}
			if err := target.Validate(ctx, table); err != nil {
				return fmt.Errorf("validate %s: %w", table.ID, err)
			}
			if err := target.PutManifest(ctx, table); err != nil {
				return err
			}
		}
		if table.Active {
			if active != "" {
				return fmt.Errorf("multiple active legacy tables")
			}
			active = table.ID
		}
	}
	if err := source.CopyBibtex(ctx); err != nil {
		return err
	}
	if err := source.CopyPages(ctx); err != nil {
		return err
	}
	if active != "" {
		return target.SetActive(ctx, active)
	}
	return nil
}
