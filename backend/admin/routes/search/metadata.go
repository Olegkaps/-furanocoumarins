package search

import (
	"admin/settings"
	"admin/utils/common"
	"time"

	"github.com/gocql/gocql"
	"github.com/gofiber/fiber/v2"
)

type GetMetadataResponse struct {
	Metadata       []ColumnMeta `json:"metadata"`
	TableTimestamp time.Time    `json:"timestamp"`
}

func Get_current_metadata(c *fiber.Ctx) error {
	cluster := gocql.NewCluster(settings.CASSANDRA_HOST)
	session, err := cluster.CreateSession()
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer session.Close()

	// find active table version
	var activeTable struct {
		Timestamp time.Time
		TableMeta string
		TableData string
	}

	iter := session.Query(`
		SELECT created_at, table_meta, table_data 
		FROM chemdb.tables
		WHERE is_active = true
		ALLOW FILTERING
	`).Iter()

	var results []struct {
		Timestamp time.Time
		TableMeta string
		TableData string
	}

	for iter.Scan(&activeTable.Timestamp, &activeTable.TableMeta, &activeTable.TableData) {
		results = append(results, activeTable)
	}

	if err := iter.Close(); err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	if len(results) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "no active table found",
		})
	}
	if len(results) > 1 {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "multiple active tables found",
		})
	}

	activeTable = results[0]

	// get table_meta (definitions of columns)
	var columns []ColumnMeta
	metaQuery := "SELECT column, type, description FROM " + activeTable.TableMeta

	iter = session.Query(metaQuery).Iter()

	for {
		var col ColumnMeta
		if !iter.Scan(&col.Column, &col.Type, &col.Description) {
			break
		}
		columns = append(columns, col)
	}

	if err = iter.Close(); err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	response := GetMetadataResponse{
		Metadata:       columns,
		TableTimestamp: activeTable.Timestamp,
	}

	return c.JSON(response)
}
