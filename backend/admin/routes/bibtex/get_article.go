package bibtex

import (
	"admin/settings"
	"admin/utils/common"

	"github.com/gocql/gocql"
	"github.com/gofiber/fiber/v2"
)

func Get_article(c *fiber.Ctx) error {
	id := c.Params("id")

	cluster := gocql.NewCluster(settings.CASSANDRA_HOST)
	session, err := cluster.CreateSession()
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer session.Close()

	iter := session.Query(`
		SELECT bibtex_text 
		FROM chemdb.bibtex
		WHERE article_id = ?
	`, id).Iter()

	var text string
	for iter.Scan(&text) {
		break
	}

	if err := iter.Close(); err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	if text == "" {
		return c.SendStatus(fiber.StatusNotFound)
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"val": text,
	})
}
