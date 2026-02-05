package search

import (
	"admin/utils/dbs"
	"admin/utils/dbs/cassandra"
	"admin/utils/http"
	"time"

	"github.com/gofiber/fiber/v2"
)

type GetMetadataResponse struct {
	Metadata       []*cassandra.ColumnMeta `json:"metadata"`
	TableTimestamp time.Time               `json:"timestamp"`
}

func Get_current_metadata(c *fiber.Ctx) error {
	session, err := dbs.CQL.CreateSession()
	if err != nil {
		return http.Resp500(c, err)
	}
	defer session.Close()

	activeTable, err := cassandra.GetActiveTable(session)
	if err != nil {
		return http.RespErr(c, err)
	}

	columns, err := cassandra.GetColumnMeta(session, activeTable)
	if err != nil {
		return http.RespErr(c, err)
	}

	response := GetMetadataResponse{
		Metadata:       columns,
		TableTimestamp: activeTable.Timestamp,
	}

	return c.JSON(response)
}
