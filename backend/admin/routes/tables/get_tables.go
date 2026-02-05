package tables

import (
	"admin/utils/dbs"
	"admin/utils/dbs/cassandra"
	"admin/utils/http"

	_ "github.com/lib/pq"

	"github.com/gofiber/fiber/v2"
)

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

	return c.JSON(tables)
}
