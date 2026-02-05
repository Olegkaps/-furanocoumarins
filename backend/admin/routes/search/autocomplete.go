package search

import (
	"admin/utils/dbs"
	"admin/utils/dbs/cassandra"
	"admin/utils/http"
	"fmt"

	"github.com/gofiber/fiber/v2"
)

type AutocompleteResponse struct {
	Values []string `json:"values"`
}

func Autocomletion(c *fiber.Ctx) error {
	column := c.Params("column")
	value := c.Query("value", "")
	if value == "" {
		return http.Resp400(c, fmt.Errorf("cannot complete empty value"))
	}

	session, err := dbs.CQL.CreateSession()
	if err != nil {
		return http.Resp500(c, err)
	}
	defer session.Close()

	table, err := cassandra.GetActiveTable(session)
	if err != nil {
		return http.RespErr(c, err)
	}

	values, err := cassandra.GetPrefix(session, table.TableData, column, value)
	if err != nil {
		return http.RespErr(c, err)
	}

	return c.JSON(AutocompleteResponse{values})
}
