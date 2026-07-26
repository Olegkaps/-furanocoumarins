package cassandra

import "github.com/gocql/gocql"

// TableImporter performs Cassandra operations within a single session.
type TableImporter interface {
	InsertTable(table *Table) error
	CreateAndBatchInsert(tableName string, columnDefs, primaryKeys []string, data [][]any) error
	SetTableOk(table *Table) error
	GetArticleIds() (map[string]string, error)
	CreateSASIIndex(tableName, column string) error
}

type sessionImporter struct {
	session *gocql.Session
}

func (i *sessionImporter) InsertTable(table *Table) error {
	return InserTable(i.session, table)
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
	return s.withSession(func(session *gocql.Session) error {
		return fn(&sessionImporter{session: session})
	})
}
