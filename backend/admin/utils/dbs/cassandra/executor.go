package cassandra

import (
	"admin/utils/http"

	"github.com/gocql/gocql"
)

type BatchData struct {
	query string
	args  []interface{}
}

type Executor struct {
	Session   *gocql.Session
	BatchSize int
	rowData   []BatchData
}

func NewExecutor(session *gocql.Session, batchSize int) *Executor {
	return &Executor{
		Session:   session,
		BatchSize: batchSize,
	}
}

func (e *Executor) Query(query string, args ...interface{}) {
	e.rowData = append(e.rowData, BatchData{
		query: query,
		args:  args,
	})
}

func (e *Executor) Execute() error {
	ind := 0
	for ind < len(e.rowData) {
		currentBatch := e.Session.NewBatch(gocql.LoggedBatch)

		for ind < len(e.rowData) && len(currentBatch.Entries) < e.BatchSize {
			currentBatch.Query(e.rowData[ind].query, e.rowData[ind].args...)
			ind++
		}

		if err := e.Session.ExecuteBatch(currentBatch); err != nil {
			return &http.ServerError{E: err}
		}
	}
	return nil
}
