package create

import (
	"context"
	"fmt"

	"github.com/gofiber/fiber/v2"
	"github.com/xuri/excelize/v2"

	_ "github.com/lib/pq"

	appcreate "admin/internal/application/create"
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

// CreateTable godoc
// @Summary      Create table from Excel file
// @Description  Uploads Excel file and creates a new table
// @Tags         tables
// @Security     BearerAuth
// @Accept       multipart/form-data
// @Param        file formData file true "Excel file"
// @Param        meta formData string false "Meta sheet name" example(meta)
// @Param        name formData string false "Table name" example(furanocoumarins_v2)
// @Success      200
// @Failure      400,500 {object} response.ErrorResponse
// @Router       /create-table [post]
func (h *Handler) CreateTable(c *fiber.Ctx) error {
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

	xlsx, err := excelize.OpenReader(f)
	if err != nil {
		return response.Resp400(c, err)
	}

	meta := c.FormValue("meta")
	tableName := c.FormValue("name")
	displayPath := file.Filename

	logging.Info(c, "accepted create-table request: file=%s table=%s meta=%s user=%s",
		displayPath, tableName, meta, dbUser.Email)

	reqLog := logging.CopyRequestFields(c)
	go h.runCreateTable(reqLog, xlsx, meta, dbUser.Email, tableName, displayPath)

	return response.Resp200(c)
}

func (h *Handler) runCreateTable(
	reqLog logging.RequestFields,
	tableFile *excelize.File,
	metaListName, authorMail, fileName, displayPath string,
) {
	reqLog.Info("starting async table import: file=%s table=%s meta=%s", displayPath, fileName, metaListName)

	sendErrorMail := func(err error) {
		reqLog.Warn("create table %s failed: %s", displayPath, err.Error())
		if mailErr := h.SendMail(context.Background(), domainmail.Message{
			To:      authorMail,
			Subject: fmt.Sprintf("Creating table %s failed.", displayPath),
			Body:    "Received following error: " + err.Error(),
		}); mailErr != nil {
			reqLog.Error("send create-table error mail: %s", mailErr)
		}
	}

	message, err := appcreate.ImportTable(h.Container.Cassandra, tableFile, metaListName, fileName, reqLog)
	if err != nil {
		sendErrorMail(err)
		return
	}

	reqLog.Info("table import finished: file=%s table=%s", displayPath, fileName)

	if mailErr := h.SendMail(context.Background(), domainmail.Message{
		To:      authorMail,
		Subject: fmt.Sprintf("Table %s created successfully.", displayPath),
		Body:    "Table created, don't forget to activate it.\n" + message,
	}); mailErr != nil {
		reqLog.Error("send create-table success mail: %s", mailErr)
	}
}
