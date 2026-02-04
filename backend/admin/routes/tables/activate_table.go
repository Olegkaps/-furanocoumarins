package tables

import (
	"admin/settings"
	"admin/utils/common"
	"admin/utils/dbs"
	"admin/utils/dbs/cassandra"

	"github.com/gocql/gocql"
	"github.com/gofiber/fiber/v2"
)

func Activate_table(c *fiber.Ctx) error {
	tableTimestamp := c.FormValue("table_timestamp")

	if tableTimestamp == "" {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	table_time, err := dbs.String2Time(tableTimestamp)
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusBadRequest)
	}

	cluster := gocql.NewCluster(settings.CASSANDRA_HOST)
	session, err := cluster.CreateSession()
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer session.Close()

	err = cassandra.ActivateTable(session, table_time)
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusBadRequest)
	}

	return c.SendStatus(fiber.StatusOK)
}
