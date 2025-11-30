package tables

import (
	"admin/settings"
	"admin/utils/common"
	"time"

	"github.com/gocql/gocql"
	"github.com/gofiber/fiber/v2"
)

func Delete_table(c *fiber.Ctx) error {
	tableTimestamp := c.FormValue("table_timestamp")
	if tableTimestamp == "" {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	go delete_table_by_timestamp(tableTimestamp)

	return c.SendStatus(fiber.StatusOK)
}

func Delete_all_bad_tables(c *fiber.Ctx) error {
	cluster := gocql.NewCluster(settings.CASSANDRA_HOST)
	session, err := cluster.CreateSession()
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer session.Close()

	selectQuery := `
		SELECT created_at
		FROM chemdb.tables
		WHERE is_ok = false
		ALLOW FILTERING
	`

	var tableTimestamp time.Time
	iter := session.Query(selectQuery).Iter()
	for iter.Scan(&tableTimestamp) {
		go delete_table_by_timestamp(tableTimestamp.Format("2006-01-02T15:04:05.000Z"))
	}

	if err := iter.Close(); err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	return c.SendStatus(fiber.StatusOK)
}

type TableMetadata struct {
	TableMeta    string `json:"table_meta"`
	TableData    string `json:"table_data"`
	TableSpecies string `json:"table_species"`
}

func delete_table_by_timestamp(tableTimestamp string) {
	table_time, err := time.Parse("2006-01-02T15:04:05.000Z", tableTimestamp)
	if err != nil {
		table_time, err = time.Parse("2006-01-02T15:04:05.00Z", tableTimestamp)
		if err != nil {
			common.WriteLog(err.Error())
			return
		}
	}
	if table_time.After(time.Now().Add(-5 * time.Minute)) {
		common.WriteLog("trying to delete table %v too early", tableTimestamp)
		return
	}

	cluster := gocql.NewCluster(settings.CASSANDRA_HOST)
	session, err := cluster.CreateSession()
	if err != nil {
		common.WriteLog(err.Error())
		return
	}
	defer session.Close()

	updateQuery := `
		UPDATE chemdb.tables 
		SET is_ok = false
		WHERE created_at = ?
		IF is_active = false
	`

	err = session.Query(updateQuery, table_time).Exec()
	if err != nil {
		common.WriteLog(err.Error())
		return
	}

	selectQuery := `
		SELECT table_meta, table_data, table_species, is_ok
		FROM chemdb.tables
		WHERE created_at = ?
	`

	var curr_is_ok bool
	var metadata TableMetadata
	err = session.Query(selectQuery, table_time).Scan(
		&metadata.TableMeta,
		&metadata.TableData,
		&metadata.TableSpecies,
		&curr_is_ok,
	)
	if err != nil {
		common.WriteLog(err.Error())
		return
	}
	if curr_is_ok {
		return
	}

	tablesToDrop := []string{
		metadata.TableMeta,
		metadata.TableData,
		metadata.TableSpecies,
	}

	is_failed := false
	for _, tableName := range tablesToDrop {
		dropQuery := "DROP TABLE IF EXISTS " + tableName
		err = session.Query(dropQuery).Exec()
		if err != nil {
			common.WriteLog("Error dropping table " + tableName + ": " + err.Error())
			is_failed = true
		}
	}
	if is_failed {
		return
	}

	deleteQuery := `DELETE FROM chemdb.tables WHERE created_at = ?`
	err = session.Query(deleteQuery, table_time).Exec()
	if err != nil {
		common.WriteLog(err.Error())
		return
	}
}
