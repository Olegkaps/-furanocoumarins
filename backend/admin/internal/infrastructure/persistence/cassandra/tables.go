package cassandra

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gocql/gocql"
	"github.com/gofiber/fiber/v2"

	"admin/internal/infrastructure/logging"
	"admin/internal/pkg/version"
	"admin/internal/presentation/http/response"
)

type Table struct {
	Timestamp       time.Time `json:"created_at" example:"2026-01-15T12:00:00Z"`
	Name            string    `json:"name" example:"furanocoumarins_v2"`
	TableMeta       string    `json:"tableMeta" example:"chemdb.meta_2026_01_15T12_00_00_000"`
	TableData       string    `json:"tableData" example:"chemdb.data_2026_01_15T12_00_00_000"`
	TableSpecies    string    `json:"tableSpecies" example:"chemdb.species_2026_01_15T12_00_00_000"`
	Version         string    `json:"version" example:"v2.0"`
	MetadataVersion *int64    `json:"metadata_version"`
	IsOk            bool      `json:"is_ok" example:"true"`
	IsActive        bool      `json:"is_active" example:"true"`
}

const reserveTableCQL = `INSERT INTO chemdb.tables (
			created_at,
			name,
			version,
			table_meta,
			table_data,
			table_species,
			is_active,
			is_ok
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?) IF NOT EXISTS;`

const tableActivationSchemaCQL = `CREATE TABLE IF NOT EXISTS chemdb.table_activation (
	scope TEXT PRIMARY KEY,
	active_created_at TIMESTAMP,
	lock_token TEXT,
	lock_expires_at TIMESTAMP)`

const activateReadyTableCQL = `
	UPDATE chemdb.tables
	SET is_active = true
	WHERE created_at = ?
	IF is_ok = true`

const updateActivePointerCQL = `
	UPDATE chemdb.table_activation
	SET active_created_at = ?
	WHERE scope = ?
	IF lock_token = ?`

const acquireTableActivationLockCQL = `
	UPDATE chemdb.table_activation
	SET lock_token = ?, lock_expires_at = ?
	WHERE scope = ?
	IF lock_token = ? AND active_created_at = ?`

const (
	tableActivationScope    = "current"
	tableActivationAttempts = 500
	tableActivationPause    = 10 * time.Millisecond
	tableActivationLease    = 10 * time.Second
)

var emptyActivationTimestamp = time.Unix(0, 0).UTC()

type tableActivationState struct {
	activeCreatedAt time.Time
	lockToken       string
	lockExpiresAt   time.Time
}

func ReserveTable(session *gocql.Session, t *Table) (bool, error) {
	existing := make(map[string]interface{})
	applied, err := session.Query(reserveTableCQL,
		t.Timestamp,
		t.Name,
		t.Version,
		t.TableMeta,
		t.TableData,
		t.TableSpecies,
		t.IsActive,
		t.IsOk,
	).SerialConsistency(gocql.LocalSerial).MapScanCAS(existing)
	if err != nil {
		return false, &response.ServerError{E: err}
	}
	return applied, nil
}

func SetTableOk(session *gocql.Session, t *Table) error {
	err := session.Query(
		`UPDATE chemdb.tables
			SET is_ok = true
			WHERE created_at = ?;`,
		t.Timestamp,
	).Exec()

	if err != nil {
		return &response.ServerError{E: err}
	}
	return nil
}

func readTableActivationState(ctx context.Context, session *gocql.Session) (tableActivationState, error) {
	var state tableActivationState
	err := session.Query(`
		SELECT active_created_at, lock_token, lock_expires_at
		FROM chemdb.table_activation
		WHERE scope = ?`, tableActivationScope,
	).WithContext(ctx).Consistency(gocql.Quorum).Scan(&state.activeCreatedAt, &state.lockToken, &state.lockExpiresAt)
	return state, err
}

func legacyActiveTimestamps(ctx context.Context, session *gocql.Session) ([]time.Time, error) {
	iter := session.Query(`
		SELECT created_at
		FROM chemdb.tables
		WHERE is_active = true
		ALLOW FILTERING`).WithContext(ctx).Iter()
	var timestamps []time.Time
	var timestamp time.Time
	for iter.Scan(&timestamp) {
		timestamps = append(timestamps, timestamp)
	}
	if err := iter.Close(); err != nil {
		return nil, err
	}
	return timestamps, nil
}

func ensureTableActivationState(session *gocql.Session) (tableActivationState, error) {
	return ensureTableActivationStateContext(context.Background(), session)
}

func ensureTableActivationStateContext(ctx context.Context, session *gocql.Session) (tableActivationState, error) {
	state, err := readTableActivationState(ctx, session)
	if err == nil {
		return state, nil
	}
	if !errors.Is(err, gocql.ErrNotFound) {
		return tableActivationState{}, &response.ServerError{E: err}
	}

	legacy, err := legacyActiveTimestamps(ctx, session)
	if err != nil {
		return tableActivationState{}, &response.ServerError{E: err}
	}
	if len(legacy) > 1 {
		return tableActivationState{}, &response.ServerError{E: fmt.Errorf("multiple legacy active tables found")}
	}
	active := emptyActivationTimestamp
	if len(legacy) == 1 {
		active = legacy[0]
	}
	initial := tableActivationState{
		activeCreatedAt: active,
		lockToken:       "",
		lockExpiresAt:   emptyActivationTimestamp,
	}
	existing := make(map[string]interface{})
	applied, err := session.Query(`
		INSERT INTO chemdb.table_activation (scope, active_created_at, lock_token, lock_expires_at)
		VALUES (?, ?, ?, ?) IF NOT EXISTS`,
		tableActivationScope, initial.activeCreatedAt, initial.lockToken, initial.lockExpiresAt,
	).WithContext(ctx).SerialConsistency(gocql.LocalSerial).MapScanCAS(existing)
	if err != nil {
		return tableActivationState{}, &response.ServerError{E: err}
	}
	if applied {
		return initial, nil
	}
	state, err = readTableActivationState(ctx, session)
	if err != nil {
		return tableActivationState{}, &response.ServerError{E: err}
	}
	return state, nil
}

func acquireTableActivationLock(session *gocql.Session) (tableActivationState, string, error) {
	token := gocql.TimeUUID().String()
	for attempt := 0; attempt < tableActivationAttempts; attempt++ {
		state, err := ensureTableActivationState(session)
		if err != nil {
			return tableActivationState{}, "", err
		}
		now := time.Now().UTC()
		if state.lockToken != "" && state.lockExpiresAt.After(now) {
			time.Sleep(tableActivationPause)
			continue
		}
		existing := make(map[string]interface{})
		applied, err := session.Query(acquireTableActivationLockCQL,
			token, now.Add(tableActivationLease), tableActivationScope, state.lockToken, state.activeCreatedAt,
		).SerialConsistency(gocql.LocalSerial).MapScanCAS(existing)
		if err != nil {
			return tableActivationState{}, "", &response.ServerError{E: err}
		}
		if applied {
			state.lockToken = token
			state.lockExpiresAt = now.Add(tableActivationLease)
			return state, token, nil
		}
		time.Sleep(tableActivationPause)
	}
	return tableActivationState{}, "", &response.ServerError{E: fmt.Errorf("table activation is busy; retry")}
}

func releaseTableActivationLock(session *gocql.Session, token string) error {
	existing := make(map[string]interface{})
	applied, err := session.Query(`
		UPDATE chemdb.table_activation
		SET lock_token = ?, lock_expires_at = ?
		WHERE scope = ?
		IF lock_token = ?`,
		"", emptyActivationTimestamp, tableActivationScope, token,
	).SerialConsistency(gocql.LocalSerial).MapScanCAS(existing)
	if err != nil {
		return &response.ServerError{E: err}
	}
	if !applied {
		return &response.ServerError{E: fmt.Errorf("table activation lock was lost")}
	}
	return nil
}

func withTableActivationLock(session *gocql.Session, operation func(tableActivationState, string) error) error {
	state, token, err := acquireTableActivationLock(session)
	if err != nil {
		return err
	}
	operationErr := operation(state, token)
	releaseErr := releaseTableActivationLock(session, token)
	return errors.Join(operationErr, releaseErr)
}

func GetActiveTable(c *fiber.Ctx, session *gocql.Session) (*Table, error) {
	state, err := ensureTableActivationState(session)
	if err != nil {
		return nil, err
	}
	if state.activeCreatedAt.Equal(emptyActivationTimestamp) {
		logging.Warn(c, "no active table found")
		return nil, &response.UserError{E: fmt.Errorf("no active table found")}
	}

	var activeTable Table
	err = session.Query(`
		SELECT created_at, table_meta, table_data, table_species, version, is_ok, name
		FROM chemdb.tables
		WHERE created_at = ?`, state.activeCreatedAt,
	).Consistency(gocql.Quorum).Scan(
		&activeTable.Timestamp,
		&activeTable.TableMeta,
		&activeTable.TableData,
		&activeTable.TableSpecies,
		&activeTable.Version,
		&activeTable.IsOk,
		&activeTable.Name,
	)
	if err != nil {
		logging.Error(c, "active table pointer is invalid: %s", err.Error())
		return nil, &response.ServerError{E: err}
	}
	if !activeTable.IsOk {
		return nil, &response.ServerError{E: fmt.Errorf("active table is not ready")}
	}
	activeTable.IsActive = true
	return &activeTable, nil
}

func GetAllTables(session *gocql.Session) ([]*Table, error) {
	tables, err := getAllTablesRaw(session)
	if err != nil {
		return nil, err
	}
	state, err := ensureTableActivationState(session)
	if err != nil {
		return nil, err
	}
	for _, table := range tables {
		table.IsActive = !state.activeCreatedAt.Equal(emptyActivationTimestamp) && table.Timestamp.Equal(state.activeCreatedAt)
	}
	return tables, nil
}

func getAllTablesRaw(session *gocql.Session) ([]*Table, error) {
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
		return nil, &response.ServerError{E: err}
	}

	return tables, nil
}

type ColumnMeta struct {
	Column      string `json:"column"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description"`
}

func GetColumnMeta(c *fiber.Ctx, session *gocql.Session, t *Table) ([]*ColumnMeta, error) {
	logging.Info(c, "get meta for '%s'", t.Timestamp)

	ge_v2 := version.IsVersionGreater(t.Version, "v2")

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
		return nil, &response.UserError{E: err}
	}

	return columns, nil
}

func DeleteTable(c *fiber.Ctx, session *gocql.Session, timestamp time.Time) error {
	if timestamp.After(time.Now().Add(-5 * time.Minute)) {
		logging.Warn(c, "trying to delete table %v - too early", timestamp)
		return nil
	}
	return withTableActivationLock(session, func(state tableActivationState, _ string) error {
		if state.activeCreatedAt.Equal(timestamp) {
			return &response.UserError{E: fmt.Errorf("cannot delete the active table")}
		}
		return deleteTableLocked(session, timestamp)
	})
}

func deleteTableLocked(session *gocql.Session, timestamp time.Time) error {

	updateQuery := `
		UPDATE chemdb.tables 
		SET is_ok = false
		WHERE created_at = ?
		IF is_active = false
	`

	existing := make(map[string]interface{})
	applied, err := session.Query(updateQuery, timestamp).
		SerialConsistency(gocql.LocalSerial).
		MapScanCAS(existing)
	if err != nil {
		return &response.UserError{E: err}
	}
	if !applied {
		return &response.UserError{E: fmt.Errorf("table is active, missing, or already being deleted")}
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
		return &response.ServerError{E: err}
	}
	if curr_is_ok {
		return &response.ServerError{E: fmt.Errorf("table %s had is_ok while deleting", timestamp)}
	}

	tablesToDrop := []string{
		metadata.TableMeta,
		metadata.TableData,
		metadata.TableSpecies,
	}
	catalog := SourceCatalogName(metadata.TableData)
	parts := strings.Split(catalog, ".")
	var found string
	err = session.Query(`SELECT table_name FROM system_schema.tables WHERE keyspace_name=? AND table_name=?`, strings.ToLower(parts[0]), strings.ToLower(parts[1])).Scan(&found)
	if err != nil && err != gocql.ErrNotFound {
		return err
	}
	if err == nil {
		iter := session.Query("SELECT virtual_name, physical_table FROM " + catalog).Iter()
		var virtual, physical string
		for iter.Scan(&virtual, &physical) {
			if err := ValidateSourceTable(metadata.TableData, metadata.TableSpecies, virtual, physical); err != nil {
				_ = iter.Close() // Preserve the source-table validation error.
				return err
			}
			if physical != metadata.TableSpecies {
				tablesToDrop = append(tablesToDrop, physical)
			}
		}
		if err := iter.Close(); err != nil {
			return err
		}
		tablesToDrop = append(tablesToDrop, catalog)
	}

	for _, tableName := range tablesToDrop {
		dropQuery := "DROP TABLE IF EXISTS " + tableName
		err = session.Query(dropQuery).Exec()
		if err != nil {
			return &response.ServerError{E: err}
		}
	}

	deleteQuery := `DELETE FROM chemdb.tables WHERE created_at = ?`
	err = session.Query(deleteQuery, timestamp).Exec()
	if err != nil {
		return &response.ServerError{E: err}
	}

	return nil
}

func ActivateTable(session *gocql.Session, timestamp time.Time) error {
	return withTableActivationLock(session, func(_ tableActivationState, token string) error {
		existing := make(map[string]interface{})
		applied, err := session.Query(activateReadyTableCQL, timestamp).SerialConsistency(gocql.LocalSerial).MapScanCAS(existing)
		if err != nil {
			return &response.ServerError{E: err}
		}
		if !applied {
			return &response.UserError{E: fmt.Errorf("table does not exist or is not ready")}
		}

		existing = make(map[string]interface{})
		applied, err = session.Query(updateActivePointerCQL, timestamp, tableActivationScope, token).SerialConsistency(gocql.LocalSerial).MapScanCAS(existing)
		if err != nil {
			return &response.ServerError{E: err}
		}
		if !applied {
			return &response.ServerError{E: fmt.Errorf("table activation lock expired")}
		}

		tables, err := getAllTablesRaw(session)
		if err != nil {
			return err
		}
		for _, table := range tables {
			if table.Timestamp.Equal(timestamp) || !table.IsActive {
				continue
			}
			if err := session.Query(`
				UPDATE chemdb.tables
				SET is_active = false
				WHERE created_at = ?`, table.Timestamp,
			).Exec(); err != nil {
				return &response.ServerError{E: err}
			}
		}
		return nil
	})
}
