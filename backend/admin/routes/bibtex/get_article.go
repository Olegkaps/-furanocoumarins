package bibtex

import (
	"admin/utils/dbs"
	"admin/utils/dbs/cassandra"
	"admin/utils/http"

	"github.com/gofiber/fiber/v2"
)

func Get_article(c *fiber.Ctx) error {
	id := c.Params("id")

	session, err := dbs.CQL.CreateSession()
	if err != nil {
		return http.Resp500(c, err)
	}
	defer session.Close()

	text, err := cassandra.GetArticle(session, id)
	if err != nil {
		return http.Resp500(c, err)
	}

	if text == "" {
		return c.SendStatus(fiber.StatusNotFound)
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"val": text,
	})
}
