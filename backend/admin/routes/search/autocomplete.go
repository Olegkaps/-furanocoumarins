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

// Autocomletion godoc
// @Summary      Autocomplete column values
// @Description  Returns prefix-matched values for a column
// @Tags         search
// @Param        column path string true "Column name"
// @Param        value query string true "Prefix to match"
// @Produce      json
// @Success      200 {object} AutocompleteResponse
// @Failure      400,500 {object} http.ErrorResponse
// @Router       /autocomplete/{column} [get]
func Autocomletion(c *fiber.Ctx) error {
	column := c.Params("column")
	value := c.Query("value", "")
	if value == "" {
		return http.Resp400(c, fmt.Errorf("cannot autocomplete empty value"))
	}

	session, err := dbs.CQL.CreateSession()
	if err != nil {
		return http.Resp500(c, err)
	}
	defer session.Close()

	table, err := cassandra.GetActiveTable(c, session)
	if err != nil {
		return http.RespErr(c, err)
	}

	values, err := cassandra.GetPrefix(session, table.TableData, column, value)
	if err != nil {
		return http.RespErr(c, err)
	}

	return http.JSON(c, AutocompleteResponse{values})
}
