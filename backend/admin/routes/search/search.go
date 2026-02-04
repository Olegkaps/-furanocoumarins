package search

import (
	"strings"
	"time"

	"github.com/gocql/gocql"
	"github.com/gofiber/fiber/v2"

	"admin/settings"
	"admin/utils/common"
	"admin/utils/dbs/cassandra"
)

type SearchResponse struct {
	Metadata       []*cassandra.ColumnMeta `json:"metadata"`
	Data           interface{}             `json:"data"`
	TableTimestamp time.Time               `json:"timestamp"`
}

func Search_main_app(c *fiber.Ctx) error {
	searchRequest := c.FormValue("search_request")

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

	// validate search_request
	err = Validate_request(searchRequest, columns)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	// select state
	var selectedColumns []string
	for col := range columns {
		if !strings.Contains(strings.ToLower(columns[col].Type), "invisible") {
			selectedColumns = append(selectedColumns, columns[col].Column)
		}
	}

	if len(selectedColumns) == 0 {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "no visible columns found in metadata",
		})
	}

	selectClause := strings.Join(selectedColumns, ", ")

	searchResults, err := cassandra.GetColumnWhere(session, selectClause, activeTable.TableData, searchRequest)
	if err != nil {
		common.WriteLog("Search query failed: " + err.Error())
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	response := SearchResponse{
		Metadata:       columns,
		Data:           searchResults,
		TableTimestamp: activeTable.Timestamp,
	}

	return c.JSON(response)
}
