package tables

import (
	"admin/utils/dbs"
	"admin/utils/dbs/cassandra"
	"admin/utils/http"

	"github.com/gofiber/fiber/v2"
)

// Activate_table godoc
// @Summary      Activate table by timestamp
// @Description  Sets the given table as the active one
// @Tags         tables
// @Security     BearerAuth
// @Param        timestamp path string true "Table timestamp"
// @Success      200
// @Failure      400,500 {object} http.ErrorResponse
// @Router       /make-table-active/{timestamp} [post]
func Activate_table(c *fiber.Ctx) error {
	tableTimestamp := c.Params("timestamp")

	table_time, err := dbs.String2Time(c, tableTimestamp)
	if err != nil {
		return http.Resp400(c, err)
	}

	session, err := dbs.CQL.CreateSession()
	if err != nil {
		return http.Resp500(c, err)
	}
	defer session.Close()

	err = cassandra.ActivateTable(session, table_time)
	if err != nil {
		return http.RespErr(c, err)
	}

	return http.Resp200(c)
}
