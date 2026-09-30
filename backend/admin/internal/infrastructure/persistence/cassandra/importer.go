package cassandra

import (
	"context"
	"crypto/sha256"
	"fmt"

	"github.com/gocql/gocql"
	"github.com/lib/pq"
)

// TableImporter performs Cassandra operations within a single session.
type TableImporter interface {
	ReserveTable(table *Table) (bool, error)
	CreateAndBatchInsert(tableName string, columnDefs, primaryKeys []string, data [][]any) error
	SetTableOk(table *Table) error
	GetArticleIds() (map[string]string, error)
	CreateSASIIndex(tableName, column string) error
}

type sessionImporter struct {
	session *gocql.Session
}

func (i *sessionImporter) ReserveTable(table *Table) (bool, error) {
	return ReserveTable(i.session, table)
}

func (i *sessionImporter) CreateAndBatchInsert(
	tableName string,
	columnDefs, primaryKeys []string,
	data [][]any,
) error {
	return CreateAndBatchInsertData(i.session, tableName, columnDefs, primaryKeys, data)
}

func (i *sessionImporter) SetTableOk(table *Table) error {
	return SetTableOk(i.session, table)
}

func (i *sessionImporter) GetArticleIds() (map[string]string, error) {
	return GetArticleIds(i.session)
}

func (i *sessionImporter) CreateSASIIndex(tableName, column string) error {
	return CreateSASIIndex(i.session, tableName, column)
}

// WithImporter runs fn within a single Cassandra session.
func (s *Store) WithImporter(fn func(TableImporter) error) error {
	if s.db != nil {
		return fn(&postgresImporter{store: s})
	}
	return s.withSession(func(session *gocql.Session) error {
		return fn(&sessionImporter{session: session})
	})
}

type postgresImporter struct{ store *Store }

func (i *postgresImporter) ReserveTable(t *Table) (bool, error) { return i.store.pgReserveTable(t) }
func (i *postgresImporter) CreateAndBatchInsert(n string, d, k []string, rows [][]any) error {
	return i.store.pgCreateAndBatchInsert(n, d, k, rows)
}
func (i *postgresImporter) SetTableOk(t *Table) error {
	err := i.store.pgSetTableOk(t)
	if err == nil {
		i.store.scheduleAutocomplete(&t.Timestamp)
	}
	return err
}
func (i *postgresImporter) GetArticleIds() (map[string]string, error) { return i.store.pgArticleIDs() }
func (i *postgresImporter) CreateSASIIndex(n, c string) error {
	return i.store.pgCreateSearchIndex(n, c)
}

func (i *postgresImporter) CreateCatalogNameIndexes(catalog string) error {
	return i.store.pgCreateCatalogNameIndexes(catalog)
}

func (i *postgresImporter) CreateSourceCountIndexes(table *Table) error {
	keys, err := i.store.EntityCountColumns(context.Background(), table)
	if err != nil {
		return err
	}
	for kind, key := range map[string]string{"chemicals": keys["chemical"], "species": keys["species"]} {
		if key == "" {
			continue
		}
		catalog, err := i.store.sourceCatalog(context.Background(), table, kind)
		if err != nil {
			return err
		}
		if kind == "chemicals" {
			if err := i.createExactIndex(table.TableData, catalog.primary); err != nil {
				return err
			}
		}
		if key == catalog.primary {
			continue
		}
		if err := i.createExactIndex(catalog.physical, key); err != nil {
			return err
		}
	}
	return nil
}

func (i *postgresImporter) createExactIndex(tableName, columnName string) error {
	table, err := pgTable(tableName)
	if err != nil {
		return err
	}
	column, err := pgColumn(columnName)
	if err != nil {
		return err
	}
	index := fmt.Sprintf("source_exact_%x", sha256.Sum256([]byte(tableName+"."+columnName)))[:60]
	_, err = i.store.db.Exec(`CREATE INDEX IF NOT EXISTS ` + pq.QuoteIdentifier(index) + ` ON ` + table + ` (` + column + `)`)
	return err
}
