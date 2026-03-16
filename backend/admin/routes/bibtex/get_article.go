package bibtex

import (
	"admin/utils/dbs"
	"admin/utils/dbs/cassandra"
	"admin/utils/http"
	"admin/utils/logging"

	"github.com/gofiber/fiber/v2"
)

// Get_article godoc
// @Summary      Get article by ID
// @Description  Returns bibtex text for the given article ID
// @Tags         bibtex
// @Param        id path string true "Article ID"
// @Produce      json
// @Success      200 {object} http.ArticleValResponse
// @Failure      404,500 {object} http.ErrorResponse
// @Router       /article/{id} [get]
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

	return http.JSON(c, http.ArticleValResponse{Val: text})
}
