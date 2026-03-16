package tables

import (
	"admin/utils/dbs"
	"admin/utils/dbs/cassandra"
	"admin/utils/http"

	_ "github.com/lib/pq"

	"github.com/gofiber/fiber/v2"
)

// Get_tables_list godoc
// @Summary      Get list of all tables
// @Description  Returns all tables from Cassandra
// @Tags         tables
// @Security     BearerAuth
// @Produce      json
// @Success      200 {array} cassandra.Table
// @Failure      500 {object} http.ErrorResponse
// @Router       /get-tables-list [post]
func Get_tables_list(c *fiber.Ctx) error {
	session, err := dbs.CQL.CreateSession()
	if err != nil {
		return http.RespErr(c, err)
	}
	defer session.Close()

	tables, err := cassandra.GetAllTables(session)
	if err != nil {
		return http.RespErr(c, err)
	}

	return http.JSON(c, tables)
}
