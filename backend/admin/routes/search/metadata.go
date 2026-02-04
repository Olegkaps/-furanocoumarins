package search

import (
	"admin/settings"
	"admin/utils/common"
	"admin/utils/dbs/cassandra"
	"time"

	"github.com/gocql/gocql"
	"github.com/gofiber/fiber/v2"
)

type GetMetadataResponse struct {
	Metadata       []*cassandra.ColumnMeta `json:"metadata"`
	TableTimestamp time.Time               `json:"timestamp"`
}

func Get_current_metadata(c *fiber.Ctx) error {
	cluster := gocql.NewCluster(settings.CASSANDRA_HOST)
	session, err := cluster.CreateSession()
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer session.Close()

	activeTable, err := cassandra.GetActiveTable(session)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	columns, err := cassandra.GetColumnMeta(session, activeTable)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	response := GetMetadataResponse{
		Metadata:       columns,
		TableTimestamp: activeTable.Timestamp,
	}

	return c.JSON(response)
}
