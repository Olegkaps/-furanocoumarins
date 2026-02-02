package search

import (
	"fmt"
	"strings"
	"time"

	"github.com/gocql/gocql"
	"github.com/gofiber/fiber/v2"

	"admin/settings"
	"admin/utils/common"
)

type ColumnMeta struct {
	Column      string `json:"column"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description"`
}

type SearchResponse struct {
	Metadata       []ColumnMeta `json:"metadata"`
	Data           interface{}  `json:"data"`
	TableTimestamp time.Time    `json:"timestamp"`
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

	// find active table version
	var activeTable struct {
		Timestamp time.Time
		TableMeta string
		TableData string
		Version   string
	}

	iter := session.Query(`
		SELECT created_at, table_meta, table_data, version
		FROM chemdb.tables
		WHERE is_active = true
		ALLOW FILTERING
	`).Iter()

	var results []struct {
		Timestamp time.Time
		TableMeta string
		TableData string
		Version   string
	}

	for iter.Scan(&activeTable.Timestamp, &activeTable.TableMeta, &activeTable.TableData, &activeTable.Version) {
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

	ge_v2 := common.IsVersionGreater(activeTable.Version, "v2")

	// get table_meta (definitions of columns)
	var columns []ColumnMeta
	var metaQuery string

	if ge_v2 {
		metaQuery = "SELECT column, type, description, show_name FROM " + activeTable.TableMeta
	} else {
		metaQuery = "SELECT column, type, description FROM " + activeTable.TableMeta
	}

	iter = session.Query(metaQuery).Iter()

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
		columns = append(columns, col)
	}

	if err = iter.Close(); err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
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

	finalQuery := fmt.Sprintf(
		"SELECT %s FROM %s WHERE %s ALLOW FILTERING",
		selectClause,
		activeTable.TableData,
		searchRequest,
	)

	// Search request
	searchResults := make([]map[string]interface{}, 0)
	iter = session.Query(finalQuery).Iter()

	row := make(map[string]interface{})

	for iter.MapScan(row) {
		searchResults = append(searchResults, row)
		row = make(map[string]interface{}) // from gocql doc
	}

	if err = iter.Close(); err != nil {
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
