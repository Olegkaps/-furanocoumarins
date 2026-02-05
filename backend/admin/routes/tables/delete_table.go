package tables

import (
	"admin/utils/dbs"
	"admin/utils/dbs/cassandra"
	"admin/utils/http"
	"fmt"
	"sync"

	"github.com/gofiber/fiber/v2"
)

func Delete_table(c *fiber.Ctx) error {
	tableTimestamp := c.FormValue("table_timestamp")
	if tableTimestamp == "" {
		return http.Resp400(c, fmt.Errorf("timestamp must not be empty"))
	}

	session, err := dbs.CQL.CreateSession()
	if err != nil {
		return http.Resp500(c, err)
	}
	defer session.Close()

	table_time, err := dbs.String2Time(tableTimestamp)
	if err != nil {
		return http.Resp400(c, err)
	}

	err = cassandra.DeleteTable(session, table_time)
	if err != nil {
		return http.RespErr(c, err)
	}

	return c.SendStatus(fiber.StatusOK)
}

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
		if t.IsOk == true {
			continue
		}
		wg.Add(1)
		go func(i int, t *cassandra.Table) {
			defer wg.Done()
			errs[i] = cassandra.DeleteTable(session, t.Timestamp)
		}(i, t)
	}
	wg.Wait()

	for _, err := range errs {
		if err != nil {
			return http.RespErr(c, err)
		}
	}

	return c.SendStatus(fiber.StatusOK)
}
