package bibtex

import (
	"fmt"
	"strings"

	"github.com/gofiber/fiber/v2"

	appbibtex "admin/internal/application/bibtex"
	"admin/internal/app"
	domainmail "admin/internal/domain/mail"
	"admin/internal/infrastructure/logging"
	"admin/internal/presentation/http/deps"
	"admin/internal/presentation/http/response"
)

type Handler struct {
	deps.Handler
}

func NewHandler(container *app.Container) *Handler {
	return &Handler{Handler: deps.New(container)}
}

// GetArticle godoc
// @Summary      Get article by ID
// @Description  Returns bibtex text for the given article ID
// @Tags         bibtex
// @Param        id path string true "Article ID" example(key2024)
// @Produce      json
// @Success      200 {object} response.ArticleValResponse
// @Failure      404,500 {object} response.ErrorResponse
// @Router       /article/{id} [get]
func (h *Handler) GetArticle(c *fiber.Ctx) error {
	id := c.Params("id")
	logging.Info(c, "get article '%s'", id)

	text, err := h.Container.Cassandra.GetArticle(id)
	if err != nil {
		return response.Resp500(c, err)
	}
	if text == "" {
		return response.Resp404(c)
	}
	return response.JSON(c, response.ArticleValResponse{Val: text})
}

// UpdateFile godoc
// @Summary      Update bibtex file
// @Description  Uploads bibtex file and updates Cassandra
// @Tags         bibtex
// @Security     BearerAuth
// @Accept       multipart/form-data
// @Param        file formData file true "Bibtex file"
// @Success      200
// @Failure      400,500 {object} response.ErrorResponse
// @Router       /bibtex [put]
func (h *Handler) UpdateFile(c *fiber.Ctx) error {
	name, err := deps.JWTUsername(c)
	if err != nil {
		return response.Resp401(c, err)
	}

	dbUser, err := h.Container.Users.FindByLoginOrEmail(c.Context(), name)
	if err != nil {
		return response.Resp400(c, err)
	}

	file, err := c.FormFile("file")
	if err != nil {
		return response.Resp400(c, err)
	}
	f, err := file.Open()
	if err != nil {
		return response.Resp400(c, err)
	}

	corrIDs, err := appbibtex.ParseBibtexFile(c, f)
	if err != nil {
		return response.Resp400(c, err)
	}

	var newIDs [][]any
	for id, val := range corrIDs {
		newIDs = append(newIDs, []any{id, val})
	}

	if err := h.Container.Cassandra.BatchInsertBibtex(newIDs); err != nil {
		return response.RespErr(c, err)
	}

	activeTable, err := h.Container.Cassandra.GetActiveTable(c)
	if err != nil {
		return response.RespErr(c, err)
	}

	columns, err := h.Container.Cassandra.GetColumnMeta(c, activeTable)
	if err != nil {
		return response.RespErr(c, err)
	}

	timestamp := activeTable.Timestamp.Format("2006-01-02 15:04:05.00000 -07:00 MST")
	var refColumn string
	for _, col := range columns {
		if strings.Contains(col.Type, "ref[]") {
			refColumn = col.Column
			break
		}
	}

	if strings.Trim(refColumn, " ") == "" {
		err = h.SendMail(c.Context(), domainmail.Message{
			To:      dbUser.Email,
			Subject: "Updated bibtex file",
			Body: fmt.Sprintf(
				"Bibtex file updated, but active table %s has no column with type `ref[]`, check skipped",
				timestamp,
			),
		})
		if err != nil {
			return response.Resp500(c, err)
		}
		logging.Warn(c, "for table %s ref-check skipped.", timestamp)
		return response.Resp200(c)
	}

	idsToCheck, err := h.Container.Cassandra.GetColumn(activeTable.TableData, refColumn)
	if err != nil {
		return response.RespErr(c, err)
	}

	warnings := appbibtex.CheckArticleIDs(corrIDs, idsToCheck)
	message := "Bibtex file updated, for active table " + timestamp
	logging.Warn(c, "for table %s have %d warnings", timestamp, len(warnings))
	if len(warnings) == 0 {
		message += " all reference exists."
	} else {
		message += " have errors:\n" + strings.Join(warnings, "\n")
	}

	if err := h.SendMail(c.Context(), domainmail.Message{
		To: dbUser.Email, Subject: "Updated bibtex file", Body: message,
	}); err != nil {
		return response.Resp500(c, err)
	}
	return response.Resp200(c)
}
