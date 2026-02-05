package tables

import (
	"admin/utils/dbs"
	"admin/utils/dbs/cassandra"
	"admin/utils/http"
	"fmt"

	"github.com/gofiber/fiber/v2"
)

func Activate_table(c *fiber.Ctx) error {
	tableTimestamp := c.FormValue("table_timestamp")
	if tableTimestamp == "" {
		return http.Resp400(c, fmt.Errorf("timestamp must not be empty"))
	}

	table_time, err := dbs.String2Time(tableTimestamp)
	if err != nil {
		return http.RespErr(c, err)
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

	return c.SendStatus(fiber.StatusOK)
}
