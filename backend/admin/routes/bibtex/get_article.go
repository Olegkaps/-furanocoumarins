package bibtex

import (
	"admin/settings"
	"admin/utils/common"
	"admin/utils/dbs/cassandra"

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

	text, err := cassandra.GetArticle(session, id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	if text == "" {
		return c.SendStatus(fiber.StatusNotFound)
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"val": text,
	})
}
