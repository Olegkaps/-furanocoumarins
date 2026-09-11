package cassandra

import "github.com/gocql/gocql"

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
func (i *postgresImporter) SetTableOk(t *Table) error                 { return i.store.pgSetTableOk(t) }
func (i *postgresImporter) GetArticleIds() (map[string]string, error) { return i.store.pgArticleIDs() }
func (i *postgresImporter) CreateSASIIndex(n, c string) error {
	return i.store.pgCreateSearchIndex(n, c)
}
