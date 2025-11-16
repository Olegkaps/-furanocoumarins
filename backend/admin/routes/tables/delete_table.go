package tables

import (
	"admin/settings"
	"admin/utils/common"

	"github.com/gocql/gocql"
	"github.com/gofiber/fiber/v2"
)

type TableMetadata struct {
	TableMeta    string `json:"table_meta"`
	TableData    string `json:"table_data"`
	TableSpecies string `json:"table_species"`
}

func Delete_table(c *fiber.Ctx) error {
	tableTimestamp := c.FormValue("table_timestamp")
	if tableTimestamp == "" {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	cluster := gocql.NewCluster(settings.CASSANDRA_HOST)
	session, err := cluster.CreateSession()
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer session.Close()

	updateQuery := `
		UPDATE chemdb.tables 
		SET is_ok = false
		WHERE created_at = ?
		IF is_active = false
	`

	var applied bool
	var currentIsActive bool

	iter := session.Query(updateQuery, tableTimestamp).Iter()

	if !iter.Scan(&applied, &currentIsActive) {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	if err := iter.Close(); err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	if !applied {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	selectQuery := `
		SELECT table_meta, table_data, table_species
		FROM chemdb.tables
		WHERE created_at = ?
	`

	var metadata TableMetadata
	err = session.Query(selectQuery, tableTimestamp).Scan(
		&metadata.TableMeta,
		&metadata.TableData,
		&metadata.TableSpecies,
	)
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	tablesToDrop := []string{
		"chemdb." + metadata.TableMeta,
		"chemdb." + metadata.TableData,
		"chemdb." + metadata.TableSpecies,
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
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	deleteQuery := `DELETE FROM chemdb.tables WHERE created_at = ?`
	err = session.Query(deleteQuery, tableTimestamp).Exec()
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	return c.SendStatus(fiber.StatusOK)
}
