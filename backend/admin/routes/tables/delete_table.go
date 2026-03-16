package tables

import (
	"admin/utils/dbs"
	"admin/utils/dbs/cassandra"
	"admin/utils/http"
	"errors"
	"sync"

	"github.com/gofiber/fiber/v2"
)

// Delete_table godoc
// @Summary      Delete table by timestamp
// @Description  Deletes the table with the given timestamp
// @Tags         tables
// @Security     BearerAuth
// @Param        timestamp path string true "Table timestamp"
// @Success      200
// @Failure      400,500 {object} http.ErrorResponse
// @Router       /table/{timestamp} [delete]
func Delete_table(c *fiber.Ctx) error {
	tableTimestamp := c.Params("timestamp")

	session, err := dbs.CQL.CreateSession()
	if err != nil {
		return http.Resp500(c, err)
	}
	defer session.Close()

	table_time, err := dbs.String2Time(c, tableTimestamp)
	if err != nil {
		return http.Resp400(c, err)
	}

	err = cassandra.DeleteTable(c, session, table_time)
	if err != nil {
		return http.RespErr(c, err)
	}

	return http.Resp200(c)
}

// Delete_all_bad_tables godoc
// @Summary      Delete all bad tables
// @Description  Deletes all tables that are not marked as OK
// @Tags         tables
// @Security     BearerAuth
// @Success      200
// @Failure      500 {object} http.ErrorResponse
// @Router       /tables [delete]
func Delete_all_bad_tables(c *fiber.Ctx) error {
	session, err := dbs.CQL.CreateSession()
	if err != nil {
		return http.Resp500(c, err)
	}
	defer session.Close()

	tables, err := cassandra.GetAllTables(session)
	if err != nil {
		return http.RespErr(c, err)
	}

	var wg sync.WaitGroup
	errs := make([]error, len(tables))
	for i, t := range tables {
		if t.IsOk {
			continue
		}
		wg.Add(1)
		go func(i int, t *cassandra.Table) {
			defer wg.Done()
			errs[i] = cassandra.DeleteTable(c, session, t.Timestamp)
		}(i, t)
	}
	wg.Wait()

	if err := errors.Join(errs...); err != nil {
		return http.RespErr(c, err)
	}

	return http.Resp200(c)
}
