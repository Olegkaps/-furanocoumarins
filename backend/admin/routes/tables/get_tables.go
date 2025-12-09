package tables

import (
	"admin/settings"
	"admin/utils/common"
	"time"

	"github.com/gocql/gocql"
	_ "github.com/lib/pq"

	"github.com/gofiber/fiber/v2"
)

type TableInfo struct {
	CreatedAt time.Time `json:"created_at"`
	Name      string    `json:"name"`
	Version   string    `json:"version"`
	IsActive  bool      `json:"is_active"`
	IsOK      bool      `json:"is_ok"`
}

func Get_tables_list(c *fiber.Ctx) error {
	cluster := gocql.NewCluster(settings.CASSANDRA_HOST)
	session, err := cluster.CreateSession()
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer session.Close()

	tables := make([]TableInfo, 0)
	iter := session.Query(`SELECT created_at, name, version, is_active, is_ok FROM chemdb.tables`).Iter()

	for {
		var table TableInfo
		if !iter.Scan(&table.CreatedAt, &table.Name, &table.Version, &table.IsActive, &table.IsOK) {
			break
		}
		tables = append(tables, table)
	}

	if err := iter.Close(); err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	return c.JSON(tables)
}
