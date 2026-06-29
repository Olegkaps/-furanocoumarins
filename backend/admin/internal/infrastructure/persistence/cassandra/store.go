package cassandra

import (
	"errors"
	"sync"
	"time"

	"github.com/gocql/gocql"
	"github.com/gofiber/fiber/v2"
)

var ErrNotConfigured = errors.New("cassandra is not configured")

// Store owns Cassandra session lifecycle.
type Store struct {
	cluster *gocql.ClusterConfig
}

func NewStore(cluster *gocql.ClusterConfig) *Store {
	return &Store{cluster: cluster}
}

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

func (s *Store) GetArticle(id string) (string, error) {
	var text string
	err := s.withSession(func(session *gocql.Session) error {
		var err error
		text, err = GetArticle(session, id)
		return err
	})
	return text, err
}

func (s *Store) GetAllTables() ([]*Table, error) {
	var tables []*Table
	err := s.withSession(func(session *gocql.Session) error {
		var err error
		tables, err = GetAllTables(session)
		return err
	})
	return tables, err
}

func (s *Store) ActivateTable(timestamp time.Time) error {
	return s.withSession(func(session *gocql.Session) error {
		return ActivateTable(session, timestamp)
	})
}

func (s *Store) DeleteTable(c *fiber.Ctx, timestamp time.Time) error {
	return s.withSession(func(session *gocql.Session) error {
		return DeleteTable(c, session, timestamp)
	})
}

func (s *Store) DeleteAllBadTables(c *fiber.Ctx) error {
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
	var table *Table
	err := s.withSession(func(session *gocql.Session) error {
		var err error
		table, err = GetActiveTable(c, session)
		return err
	})
	return table, err
}

func (s *Store) GetColumnMeta(c *fiber.Ctx, table *Table) ([]*ColumnMeta, error) {
	var columns []*ColumnMeta
	err := s.withSession(func(session *gocql.Session) error {
		var err error
		columns, err = GetColumnMeta(c, session, table)
		return err
	})
	return columns, err
}

func (s *Store) GetColumnWhere(tableData, selectClause, where string) ([]map[string]any, error) {
	var results []map[string]any
	err := s.withSession(func(session *gocql.Session) error {
		var err error
		results, err = GetColumnWhere(session, tableData, selectClause, where)
		return err
	})
	return results, err
}

func (s *Store) GetPrefix(tableData, column, prefix string) ([]string, error) {
	var values []string
	err := s.withSession(func(session *gocql.Session) error {
		var err error
		values, err = GetPrefix(session, tableData, column, prefix)
		return err
	})
	return values, err
}

func (s *Store) GetPageKey(name string) (string, error) {
	var key string
	err := s.withSession(func(session *gocql.Session) error {
		var err error
		key, err = GetPageKey(session, name)
		return err
	})
	return key, err
}

func (s *Store) SetPageKey(name, s3Key string) error {
	return s.withSession(func(session *gocql.Session) error {
		return SetPageKey(session, name, s3Key)
	})
}

func (s *Store) BatchInsertBibtex(rows [][]any) error {
	return s.withSession(func(session *gocql.Session) error {
		return BatchInsertData(session, "chemdb.bibtex", []string{"article_id", "bibtex_text"}, rows, 10)
	})
}

func (s *Store) GetColumn(tableData, column string) ([]string, error) {
	var values []string
	err := s.withSession(func(session *gocql.Session) error {
		var err error
		values, err = GetColumn(session, tableData, column)
		return err
	})
	return values, err
}
