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

// Get_current_metadata godoc
// @Summary      Get current table metadata
// @Description  Returns metadata and timestamp of the active table
// @Tags         search
// @Produce      json
// @Success      200 {object} GetMetadataResponse
// @Failure      500 {object} http.ErrorResponse
// @Router       /metadata [get]
func Get_current_metadata(c *fiber.Ctx) error {
	session, err := dbs.CQL.CreateSession()
	if err != nil {
		return http.Resp500(c, err)
	}
	defer session.Close()

	activeTable, err := cassandra.GetActiveTable(c, session)
	if err != nil {
		return http.RespErr(c, err)
	}

	columns, err := cassandra.GetColumnMeta(c, session, activeTable)
	if err != nil {
		return http.RespErr(c, err)
	}

	response := GetMetadataResponse{
		Metadata:       columns,
		TableTimestamp: activeTable.Timestamp,
	}

	return http.JSON(c, response)
}
