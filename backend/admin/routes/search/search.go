package search

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"admin/utils/dbs"
	"admin/utils/dbs/cassandra"
	"admin/utils/http"
)

type SearchResponse struct {
	Metadata       []*cassandra.ColumnMeta `json:"metadata"`
	Data           interface{}             `json:"data"`
	TableTimestamp time.Time               `json:"timestamp"`
}

func Search_main_app(c *fiber.Ctx) error {
	searchRequest := c.Query("q")

	session, err := dbs.CQL.CreateSession()
	if err != nil {
		return http.Resp500(c, err)
	}
	defer session.Close()

	activeTable, err := cassandra.GetActiveTable(c, session)
	if err != nil {
		return http.RespErr(c, err)
	}

	columns, err1 := cassandra.GetColumnMeta(c, session, activeTable)
	err2 := Validate_request(searchRequest, columns)

	if err := errors.Join(err1, err2); err != nil {
		return http.RespErr(c, err)
	}

	// select state
	var selectedColumns []string
	for col := range columns {
		if !strings.Contains(strings.ToLower(columns[col].Type), "invisible") {
			selectedColumns = append(selectedColumns, columns[col].Column)
		}
	}

	if len(selectedColumns) == 0 {
		return http.Resp400(c, fmt.Errorf("no visible columns found in metadata"))
	}

	selectClause := strings.Join(selectedColumns, ", ")

	searchResults, err := cassandra.GetColumnWhere(session, activeTable.TableData, selectClause, searchRequest)
	if err != nil {
		return http.RespErr(c, err)
	}

	response := SearchResponse{
		Metadata:       columns,
		Data:           searchResults,
		TableTimestamp: activeTable.Timestamp,
	}

	return http.JSON(c, response)
}
