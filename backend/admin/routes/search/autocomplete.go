package search

import (
	"admin/settings"
	"admin/utils/common"
	"admin/utils/dbs/cassandra"

	"github.com/gocql/gocql"
	"github.com/gofiber/fiber/v2"
)

type AutocompleteResponse struct {
	Values []string `json:"values"`
}

func Autocomletion(c *fiber.Ctx) error {
	column := c.Params("column")
	value := c.Query("value", "")
	if value == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "cannot complete empty value",
		})
	}

	cluster := gocql.NewCluster(settings.CASSANDRA_HOST)
	session, err := cluster.CreateSession()
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer session.Close()

	table, err := cassandra.GetActiveTable(session)
	if err != nil {
		common.WriteLog("Search query failed: " + err.Error())
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	values, err := cassandra.GetPrefix(session, table.TableData, column, value)
	if err != nil {
		common.WriteLog("Search query failed: " + err.Error())
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	return c.JSON(AutocompleteResponse{values})
}
