package tables

import (
	"admin/settings"
	"admin/utils/common"
	"admin/utils/dbs"
	"admin/utils/dbs/cassandra"
	"sync"

	"github.com/gocql/gocql"
	"github.com/gofiber/fiber/v2"
)

func Delete_table(c *fiber.Ctx) error {
	tableTimestamp := c.FormValue("table_timestamp")
	if tableTimestamp == "" {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	cluster := gocql.NewCluster(settings.CASSANDRA_HOST)
	session, err := cluster.CreateSession()
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer session.Close()

	table_time, err := dbs.String2Time(tableTimestamp)
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusBadRequest)
	}

	err = cassandra.DeleteTable(session, table_time)
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusBadRequest)
	}

	return c.SendStatus(fiber.StatusOK)
}

func Delete_all_bad_tables(c *fiber.Ctx) error {
	cluster := gocql.NewCluster(settings.CASSANDRA_HOST)
	session, err := cluster.CreateSession()
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer session.Close()

	tables, err := cassandra.GetAllTables(session)
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
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
			common.WriteLog(err.Error())
			return c.SendStatus(fiber.StatusInternalServerError)
		}
	}

	return c.SendStatus(fiber.StatusOK)
}
