package create

import (
	"context"
	"fmt"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
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

// Create_table godoc
// @Summary      Create table from Excel file
// @Description  Uploads Excel file and creates a new table
// @Tags         tables
// @Security     BearerAuth
// @Accept       multipart/form-data
// @Param        file formData file true "Excel file"
// @Success      200
// @Failure      400,500 {object} response.ErrorResponse
// @Router       /create-table [post]
func (h *Handler) Create_table(c *fiber.Ctx) error {
	user := c.Locals("user").(*jwt.Token)
	claims := user.Claims.(jwt.MapClaims)
	name := claims["name"].(string)

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

	h.createTableAsync(c, xlsx, meta, dbUser.Email, tableName)

	return response.Resp200(c)
}

func (h *Handler) createTableAsync(c *fiber.Ctx, tableFile *excelize.File, metaListName, authorMail, fileName string) {
	sendErrorMail := func(err error) {
		logging.Warn(c, "%s", err.Error())
		if mailErr := h.SendMail(context.Background(), domainmail.Message{
			To:      authorMail,
			Subject: fmt.Sprintf("Creating table %s failed.", tableFile.Path),
			Body:    "Recieved following error: " + err.Error(),
		}); mailErr != nil {
			logging.Error(c, "%s", mailErr)
		}
	}

	message, err := appcreate.ImportTable(c, h.Container.Cassandra, tableFile, metaListName, fileName)
	if err != nil {
		sendErrorMail(err)
		return
	}

	if mailErr := h.SendMail(context.Background(), domainmail.Message{
		To:      authorMail,
		Subject: fmt.Sprintf("Table %s created successfully.", tableFile.Path),
		Body:    "Table created, don`t forget to activate it.\n" + message,
	}); mailErr != nil {
		logging.Error(c, "%s", mailErr)
	}
}
