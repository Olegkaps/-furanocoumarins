package tables

import (
	"admin/settings"
	"admin/utils/common"
	"time"

	"github.com/gocql/gocql"
	"github.com/gofiber/fiber/v2"
)

func Activate_table(c *fiber.Ctx) error {
	tableTimestamp := c.FormValue("table_timestamp")

	if tableTimestamp == "" {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	table_time, err := time.Parse("2006-01-02T15:04:05.000Z", tableTimestamp)
	if err != nil {
		table_time, err = time.Parse("2006-01-02T15:04:05.00Z", tableTimestamp)
		if err != nil {
			common.WriteLog(err.Error())
			return c.SendStatus(fiber.StatusBadRequest)
		}
	}

	cluster := gocql.NewCluster(settings.CASSANDRA_HOST)
	session, err := cluster.CreateSession()
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer session.Close()

	activateQuery := `
		UPDATE chemdb.tables
		SET is_active = true
		WHERE created_at = ?
		IF is_ok = true AND is_active = false
	`

	if err = session.Query(activateQuery, table_time).Exec(); err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusBadRequest)
	}

	selectQuery := `
		SELECT created_at
		FROM chemdb.tables
		WHERE is_active = true
		ALLOW FILTERING
	`

	var applied bool
	var active_tables []time.Time
	var curr_table_timestamp time.Time

	iter := session.Query(selectQuery).Iter()
	for iter.Scan(&curr_table_timestamp) {
		if curr_table_timestamp.Equal(table_time) {
			applied = true
			continue
		}
		active_tables = append(active_tables, curr_table_timestamp)
	}

	if !applied {
		common.WriteLog("failed to set activate table %v", tableTimestamp)
		return c.SendStatus(fiber.StatusBadRequest)
	}

	deactivateQuery := `
		UPDATE chemdb.tables
		SET is_active = false
		WHERE created_at = ?
	`

	for _, curr_curr_table_timestamp := range active_tables {
		err = session.Query(deactivateQuery, curr_curr_table_timestamp).Exec()
		if err != nil {
			common.WriteLog(err.Error())
			return c.SendStatus(fiber.StatusInternalServerError)
		}
	}

	return c.SendStatus(fiber.StatusOK)
}
