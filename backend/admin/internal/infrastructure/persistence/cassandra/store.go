package cassandra

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/gocql/gocql"
	"github.com/gofiber/fiber/v2"
)

var ErrNotConfigured = errors.New("cassandra is not configured")

// Store owns Cassandra session lifecycle.
type Store struct {
	cluster *gocql.ClusterConfig
	db      *sql.DB
}

func NewStore(cluster *gocql.ClusterConfig) *Store {
	return &Store{cluster: cluster}
}

// NewPostgresStore is the production data store.  The package name is kept
// temporarily for API compatibility with the workbook importer; it never
// opens a CQL session.
func NewPostgresStore(db *sql.DB) *Store { return &Store{db: db} }

func (s *Store) withSession(fn func(*gocql.Session) error) error {
	if s.cluster == nil {
		return ErrNotConfigured
	}
	session, err := s.cluster.CreateSession()
	if err != nil {
		return err
	}
	defer session.Close()
	return fn(session)
}

// EnsureActivationSchema upgrades pre-activation-pointer Cassandra clusters
// before HTTP starts accepting requests. Startup fails closed if the schema or
// one-time legacy active-row migration cannot complete.
func (s *Store) EnsureActivationSchema(ctx context.Context) error {
	if s.db != nil {
		return s.ensurePostgresSchema(ctx)
	}
	return s.withSession(func(session *gocql.Session) error {
		if err := session.Query(tableActivationSchemaCQL).WithContext(ctx).Exec(); err != nil {
			return fmt.Errorf("create table activation schema: %w", err)
		}
		if err := session.AwaitSchemaAgreement(ctx); err != nil {
			return fmt.Errorf("await table activation schema agreement: %w", err)
		}
		if _, err := ensureTableActivationStateContext(ctx, session); err != nil {
			return fmt.Errorf("initialize table activation state: %w", err)
		}
		return nil
	})
}

func (s *Store) GetArticle(id string) (string, error) {
	if s.db != nil {
		return s.pgGetArticle(id)
	}
	var text string
	err := s.withSession(func(session *gocql.Session) error {
		var err error
		text, err = GetArticle(session, id)
		return err
	})
	return text, err
}

func (s *Store) GetAllTables() ([]*Table, error) {
	if s.db != nil {
		return s.pgGetAllTables()
	}
	var tables []*Table
	err := s.withSession(func(session *gocql.Session) error {
		var err error
		tables, err = GetAllTables(session)
		return err
	})
	return tables, err
}

func (s *Store) ActivateTable(timestamp time.Time) error {
	if s.db != nil {
		return s.pgActivateTable(timestamp)
	}
	return s.withSession(func(session *gocql.Session) error {
		return ActivateTable(session, timestamp)
	})
}

func (s *Store) DeleteTable(c *fiber.Ctx, timestamp time.Time) error {
	if s.db != nil {
		return s.pgDeleteTable(c, timestamp)
	}
	return s.withSession(func(session *gocql.Session) error {
		return DeleteTable(c, session, timestamp)
	})
}

func (s *Store) DeleteAllBadTables(c *fiber.Ctx) error {
	if s.db != nil {
		return s.pgDeleteAllBadTables(c)
	}
	return s.withSession(func(session *gocql.Session) error {
		tables, err := GetAllTables(session)
		if err != nil {
			return err
		}

		var wg sync.WaitGroup
		errs := make([]error, len(tables))
		for i, t := range tables {
			if t.IsOk {
				continue
			}
			wg.Add(1)
			go func(i int, table *Table) {
				defer wg.Done()
				errs[i] = DeleteTable(c, session, table.Timestamp)
			}(i, t)
		}
		wg.Wait()

		for _, err := range errs {
			if err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Store) GetActiveTable(c *fiber.Ctx) (*Table, error) {
	if s.db != nil {
		return s.pgGetActiveTable(c)
	}
	var table *Table
	err := s.withSession(func(session *gocql.Session) error {
		var err error
		table, err = GetActiveTable(c, session)
		return err
	})
	return table, err
}

func (s *Store) GetColumnMeta(c *fiber.Ctx, table *Table) ([]*ColumnMeta, error) {
	if s.db != nil {
		return s.pgGetColumnMeta(c, table)
	}
	var columns []*ColumnMeta
	err := s.withSession(func(session *gocql.Session) error {
		var err error
		columns, err = GetColumnMeta(c, session, table)
		return err
	})
	return columns, err
}

func (s *Store) GetColumnWhere(tableData, selectClause, where string) ([]map[string]any, error) {
	if s.db != nil {
		return s.pgGetColumnWhere(tableData, selectClause, where)
	}
	var results []map[string]any
	err := s.withSession(func(session *gocql.Session) error {
		var err error
		results, err = GetColumnWhere(session, tableData, selectClause, where)
		return err
	})
	return results, err
}

func (s *Store) GetPrefix(tableData, column, prefix string) ([]string, error) {
	if s.db != nil {
		return s.pgGetPrefix(tableData, column, prefix)
	}
	var values []string
	err := s.withSession(func(session *gocql.Session) error {
		var err error
		values, err = GetPrefix(session, tableData, column, prefix)
		return err
	})
	return values, err
}

func (s *Store) GetPageKey(name string) (string, error) {
	if s.db != nil {
		return s.pgGetPageKey(name)
	}
	var key string
	err := s.withSession(func(session *gocql.Session) error {
		var err error
		key, err = GetPageKey(session, name)
		return err
	})
	return key, err
}

func (s *Store) SetPageKey(name, s3Key string) error {
	if s.db != nil {
		return s.pgSetPageKey(name, s3Key)
	}
	return s.withSession(func(session *gocql.Session) error {
		return SetPageKey(session, name, s3Key)
	})
}

func (s *Store) BatchInsertBibtex(rows [][]any) error {
	if s.db != nil {
		return s.pgBatchInsertBibtex(rows)
	}
	return s.withSession(func(session *gocql.Session) error {
		return BatchInsertData(session, "chemdb.bibtex", []string{"article_id", "bibtex_text"}, rows, 10)
	})
}

func (s *Store) GetColumn(tableData, column string) ([]string, error) {
	if s.db != nil {
		return s.pgGetColumn(tableData, column)
	}
	var values []string
	err := s.withSession(func(session *gocql.Session) error {
		var err error
		values, err = GetColumn(session, tableData, column)
		return err
	})
	return values, err
}
