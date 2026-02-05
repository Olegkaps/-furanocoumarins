package cassandra

import (
	"admin/utils/common"
	"admin/utils/http"
	"fmt"
	"time"

	"github.com/gocql/gocql"
)

type Table struct {
	Timestamp    time.Time `json:"created_at"`
	Name         string    `json:"name"`
	TableMeta    string
	TableData    string
	TableSpecies string
	Version      string `json:"version"`
	IsOk         bool   `json:"is_ok"`
	IsActive     bool   `json:"is_active"`
}

func InserTable(session *gocql.Session, t *Table) error {
	err := session.Query(
		`INSERT INTO chemdb.tables (
			created_at,
			name,
			version,
			table_meta,
			table_data,
			table_species,
			is_active,
			is_ok
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
		t.Timestamp,
		t.Name,
		t.Version,
		t.TableMeta,
		t.TableData,
		t.TableSpecies,
		t.IsActive,
		t.IsOk,
	).Exec()
	if err != nil {
		return &http.UserError{E: err}
	}
	return nil
}

func SetTableOk(session *gocql.Session, t *Table) error {
	err := session.Query(
		`UPDATE chemdb.tables
			SET is_ok = true
			WHERE created_at = ?;`,
		t.Timestamp,
	).Exec()

	if err != nil {
		return &http.ServerError{E: err}
	}
	return nil
}

func GetActiveTable(session *gocql.Session) (*Table, error) {
	iter := session.Query(`
		SELECT created_at, table_meta, table_data, version, is_ok, is_active, name
		FROM chemdb.tables
		WHERE is_active = true
		ALLOW FILTERING
	`).Iter()

	results := []Table{}

	var activeTable Table
	for iter.Scan(
		&activeTable.Timestamp,
		&activeTable.TableMeta,
		&activeTable.TableData,
		&activeTable.Version,
		&activeTable.IsOk,
		&activeTable.IsActive,
		&activeTable.Name,
	) {
		results = append(results, activeTable)
	}

	if err := iter.Close(); err != nil {
		common.WriteLog(err.Error())
		return nil, &http.ServerError{E: err}
	}
	if len(results) == 0 {
		common.WriteLog("no active table found")
		return nil, &http.UserError{E: fmt.Errorf("no active table found")}
	}
	if len(results) > 1 {
		common.WriteLog("multiple active tables found")
		return nil, &http.UserError{E: fmt.Errorf("multiple active tables found")}
	}

	return &results[0], nil
}

func GetAllTables(session *gocql.Session) ([]*Table, error) {
	tables := make([]*Table, 0)
	iter := session.Query(`SELECT created_at, name, version, is_active, is_ok FROM chemdb.tables`).Iter()

	for {
		var table Table
		if !iter.Scan(&table.Timestamp, &table.Name, &table.Version, &table.IsActive, &table.IsOk) {
			break
		}
		tables = append(tables, &table)
	}

	if err := iter.Close(); err != nil {
		return nil, &http.ServerError{E: err}
	}

	return tables, nil
}

type ColumnMeta struct {
	Column      string `json:"column"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description"`
}

func GetColumnMeta(session *gocql.Session, t *Table) ([]*ColumnMeta, error) {
	common.WriteLog("get meta for '%s'", t.Timestamp)

	ge_v2 := common.IsVersionGreater(t.Version, "v2")

	// get table_meta (definitions of columns)
	var columns []*ColumnMeta

	var metaQuery string
	if ge_v2 {
		metaQuery = "SELECT column, type, description, show_name FROM " + t.TableMeta
	} else {
		metaQuery = "SELECT column, type, description FROM " + t.TableMeta
	}

	iter := session.Query(metaQuery).Iter()

	for {
		var col ColumnMeta
		if ge_v2 {
			if !iter.Scan(&col.Column, &col.Type, &col.Description, &col.Name) {
				break
			}
			if col.Name == "" {
				col.Name = col.Column
			}
		} else {
			if !iter.Scan(&col.Column, &col.Type, &col.Description) {
				break
			}
			col.Name = col.Column
		}
		columns = append(columns, &col)
	}

	if err := iter.Close(); err != nil {
		return nil, &http.UserError{E: err}
	}

	return columns, nil
}

func DeleteTable(session *gocql.Session, timestamp time.Time) error {
	if timestamp.After(time.Now().Add(-5 * time.Minute)) {
		common.WriteLog("trying to delete table %v - too early", timestamp)
		return nil
	}

	updateQuery := `
		UPDATE chemdb.tables 
		SET is_ok = false
		WHERE created_at = ?
		IF is_active = false
	`

	err := session.Query(updateQuery, timestamp).Exec()
	if err != nil {
		return &http.UserError{E: err}
	}

	selectQuery := `
		SELECT table_meta, table_data, table_species, is_ok
		FROM chemdb.tables
		WHERE created_at = ?
	`

	var curr_is_ok bool
	var metadata Table
	err = session.Query(selectQuery, timestamp).Scan(
		&metadata.TableMeta,
		&metadata.TableData,
		&metadata.TableSpecies,
		&curr_is_ok,
	)
	if err != nil {
		return &http.ServerError{E: err}
	}
	if curr_is_ok {
		return &http.ServerError{E: fmt.Errorf("table %s had is_ok while deleting", timestamp)}
	}

	tablesToDrop := []string{
		metadata.TableMeta,
		metadata.TableData,
		metadata.TableSpecies,
	}

	for _, tableName := range tablesToDrop {
		dropQuery := "DROP TABLE IF EXISTS " + tableName
		err = session.Query(dropQuery).Exec()
		if err != nil {
			return &http.ServerError{E: err}
		}
	}

	deleteQuery := `DELETE FROM chemdb.tables WHERE created_at = ?`
	err = session.Query(deleteQuery, timestamp).Exec()
	if err != nil {
		return &http.ServerError{E: err}
	}

	return nil
}

func ActivateTable(session *gocql.Session, timestamp time.Time) error {
	activateQuery := `
		UPDATE chemdb.tables
		SET is_active = true
		WHERE created_at = ?
		IF is_ok = true
	`

	if err := session.Query(activateQuery, timestamp).Exec(); err != nil {
		return &http.UserError{E: err}
	}

	selectQuery := `
		SELECT created_at
		FROM chemdb.tables
		WHERE is_active = true
		ALLOW FILTERING
	`

	var active_tables []time.Time
	var curr_timestamp time.Time

	iter := session.Query(selectQuery).Iter()
	for iter.Scan(&curr_timestamp) {
		if curr_timestamp.Equal(timestamp) {
			continue
		}
		active_tables = append(active_tables, curr_timestamp)
	}

	err := iter.Close()
	if err != nil {
		return &http.ServerError{E: err}
	}

	deactivateQuery := `
		UPDATE chemdb.tables
		SET is_active = false
		WHERE created_at = ?
	`

	for _, curr_timestamp := range active_tables {
		err = session.Query(deactivateQuery, curr_timestamp).Exec()
		if err != nil {
			return &http.ServerError{E: err}
		}
	}
	return nil
}
