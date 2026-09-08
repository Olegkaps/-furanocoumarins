package create

import (
	"context"
	"fmt"
	"io"

	"github.com/gofiber/fiber/v2"
	"github.com/xuri/excelize/v2"

	_ "github.com/lib/pq"

	"admin/internal/app"
	appcreate "admin/internal/application/create"
	domainmail "admin/internal/domain/mail"
	"admin/internal/infrastructure/logging"
	"admin/internal/presentation/http/deps"
	"admin/internal/presentation/http/response"
)

type Handler struct {
	deps.Handler
	imports      *importTracker
	openWorkbook func(io.Reader) (*excelize.File, error)
	importTable  func(*excelize.File, string, string, logging.Logger) (string, error)
}

const (
	// The backend container is capped at 128 MiB. Bound aggregate extracted
	// workbook data and individual XML documents well below that budget.
	workbookUnzipSizeLimit    = 32 << 20
	workbookUnzipXMLSizeLimit = 4 << 20
)

func openWorkbook(reader io.Reader) (*excelize.File, error) {
	return excelize.OpenReader(reader, excelize.Options{
		UnzipSizeLimit:    workbookUnzipSizeLimit,
		UnzipXMLSizeLimit: workbookUnzipXMLSizeLimit,
	})
}

func NewHandler(container *app.Container) *Handler {
	h := &Handler{Handler: deps.New(container), imports: newImportTracker(), openWorkbook: openWorkbook}
	h.importTable = func(file *excelize.File, meta, name string, log logging.Logger) (string, error) {
		return appcreate.ImportTable(container.Cassandra, file, meta, name, log)
	}
	return h
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
	authorEmail, err := deps.AuthEmail(c)
	if err != nil {
		return response.Resp401(c, err)
	}

	file, err := c.FormFile("file")
	if err != nil {
		return response.Resp400(c, err)
	}

	meta := c.FormValue("meta")
	tableName := c.FormValue("name")
	displayPath := file.Filename

	logging.Info(c, "accepted create-table request: file=%s table=%s meta=%s user=%s",
		displayPath, tableName, meta, authorEmail)

	reqLog := logging.CopyRequestFields(c)
	job, accepted := h.imports.tryStart(tableName)
	if !accepted {
		return c.Status(fiber.StatusConflict).JSON(response.ErrorResponse{Error: "another import is already running; wait and retry"})
	}

	// Admission precedes opening and inflating the archive so a busy service
	// never holds multiple decompressed workbooks in its 128 MiB process.
	f, err := file.Open()
	if err != nil {
		h.imports.discard(job.ID)
		return response.Resp400(c, err)
	}
	defer f.Close()

	opener := h.openWorkbook
	if opener == nil {
		opener = openWorkbook
	}
	xlsx, err := opener(f)
	if err != nil {
		h.imports.discard(job.ID)
		return response.Resp400(c, fmt.Errorf("invalid or over-expanded workbook: %w", err))
	}
	go h.runCreateTable(reqLog, xlsx, meta, authorEmail, tableName, displayPath, job.ID)

	return response.JSON(c, job)
}

// ImportStatus reports the actual asynchronous import state. It intentionally
// exposes no parser, Cassandra, path, or email error details; operators retain
// those in backend logs and the existing notification email.
func (h *Handler) ImportStatus(c *fiber.Ctx) error {
	job, ok := h.imports.get(c.Params("importID"))
	if !ok {
		return response.Resp404(c)
	}
	return response.JSON(c, job)
}

func (h *Handler) runCreateTable(
	reqLog logging.RequestFields,
	tableFile *excelize.File,
	metaListName, authorMail, fileName, displayPath, importID string,
) {
	defer func() {
		if err := tableFile.Close(); err != nil {
			reqLog.Warn("close uploaded workbook failed")
		}
		if recovered := recover(); recovered != nil {
			h.imports.finish(importID, broken)
			reqLog.Error("table import stopped after an unexpected internal failure")
			if h.Container != nil && h.Container.Mail != nil {
				if mailErr := h.SendMail(context.Background(), domainmail.Message{
					To: authorMail, Subject: "Table import failed.",
					Body: "The import stopped after an unexpected internal failure. Check the workbook and retry, or contact an operator.",
				}); mailErr != nil {
					reqLog.Error("send sanitized import failure mail failed")
				}
			}
		}
	}()
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

	message, err := h.importTable(tableFile, metaListName, fileName, reqLog)
	if err != nil {
		h.imports.finish(importID, broken)
		sendErrorMail(err)
		return
	}
	h.imports.finish(importID, ready)

	reqLog.Info("table import finished: file=%s table=%s", displayPath, fileName)

	if mailErr := h.SendMail(context.Background(), domainmail.Message{
		To:      authorMail,
		Subject: fmt.Sprintf("Table %s created successfully.", displayPath),
		Body:    "Table created, don't forget to activate it.\n" + message,
	}); mailErr != nil {
		reqLog.Error("send create-table success mail: %s", mailErr)
	}
}
