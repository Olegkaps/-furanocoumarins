package tables

import (
	"admin/settings"
	"admin/utils/common"

	"github.com/gocql/gocql"
	"github.com/gofiber/fiber/v2"
)

func Activate_table(c *fiber.Ctx) error { // TO DO: set is_active = False for another
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

	query := `
		UPDATE chemdb.tables 
		SET is_active = true 
		WHERE created_at = ?
		IF is_ok = true AND is_active = false
	`

	var applied bool
	var currentIsOK bool
	var currentIsActive bool

	iter := session.Query(query, tableTimestamp).Iter()
	if !iter.Scan(&applied, &currentIsOK, &currentIsActive) {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	if err := iter.Close(); err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	if !applied {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	// wtf ?
	deactivateQuery := `
		UPDATE chemdb.tables
		SET is_active = false
		WHERE created_at = ?
		IF EXISTS
	`

	err = session.Query(deactivateQuery, tableTimestamp).Exec()
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	return c.SendStatus(fiber.StatusOK)
}
