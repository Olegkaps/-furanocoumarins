package tables

import (
	"admin/settings"
	"admin/utils/common"
	"admin/utils/dbs/cassandra"

	"github.com/gocql/gocql"
	_ "github.com/lib/pq"

	"github.com/gofiber/fiber/v2"
)

func Get_tables_list(c *fiber.Ctx) error {
	cluster := gocql.NewCluster(settings.CASSANDRA_HOST)
	session, err := cluster.CreateSession()
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer session.Close()

	tables, err := cassandra.GetAllTables(session)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	return c.JSON(tables)
}
