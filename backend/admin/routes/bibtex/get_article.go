package bibtex

import (
	"admin/utils/dbs"
	"admin/utils/dbs/cassandra"
	"admin/utils/http"
	"admin/utils/logging"

	"github.com/gofiber/fiber/v2"
)

func Get_article(c *fiber.Ctx) error {
	id := c.Params("id")
	logging.Info(c, "get article '%s'", id)

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
		return http.Resp404(c)
	}

	return http.JSON(c, fiber.Map{
		"val": text,
	})
}
