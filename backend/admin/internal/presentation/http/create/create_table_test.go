package create

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"

	"admin/internal/app"
	infraauth "admin/internal/infrastructure/authmaster"
	"admin/internal/infrastructure/logging"
	mailmemory "admin/internal/infrastructure/mail/memory"
	"admin/internal/presentation/http/deps"
)

func multipartWorkbookRequest(t *testing.T) *http.Request {
	t.Helper()
	workbook := excelize.NewFile()
	var xlsx bytes.Buffer
	require.NoError(t, workbook.Write(&xlsx))
	require.NoError(t, workbook.Close())
	return multipartWorkbookBytesRequest(t, xlsx.Bytes())
}

func multipartWorkbookBytesRequest(t *testing.T, xlsx []byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "fixture.xlsx")
	require.NoError(t, err)
	_, err = part.Write(xlsx)
	require.NoError(t, err)
	require.NoError(t, writer.WriteField("meta", "meta"))
	require.NoError(t, writer.WriteField("name", "fixture"))
	require.NoError(t, writer.Close())
	req := httptest.NewRequest(fiber.MethodPost, "/create-table", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}

func TestCreateTableReturnsConflictWhileImportingAndAcceptsAfterCompletion(t *testing.T) {
	mailer := mailmemory.NewSender()
	h := &Handler{Handler: deps.New(&app.Container{Mail: mailer}), imports: newImportTracker()}
	var workbookOpens atomic.Int32
	h.openWorkbook = func(reader io.Reader) (*excelize.File, error) {
		workbookOpens.Add(1)
		return openWorkbook(reader)
	}
	started := make(chan struct{}, 2)
	release := make(chan struct{}, 2)
	h.importTable = func(*excelize.File, string, string, logging.Logger) (string, error) {
		started <- struct{}{}
		<-release
		return "ready", nil
	}
	application := fiber.New()
	application.Post("/create-table", func(c *fiber.Ctx) error {
		email := "admin@example.test"
		c.Locals("auth-master-user", infraauth.User{Login: "admin", Email: &email})
		return h.CreateTable(c)
	})

	first, err := application.Test(multipartWorkbookRequest(t))
	require.NoError(t, err)
	require.Equal(t, fiber.StatusOK, first.StatusCode)
	var firstJob importJob
	require.NoError(t, json.NewDecoder(first.Body).Decode(&firstJob))
	first.Body.Close()
	<-started
	require.Equal(t, int32(1), workbookOpens.Load())

	second, err := application.Test(multipartWorkbookRequest(t))
	require.NoError(t, err)
	require.Equal(t, fiber.StatusConflict, second.StatusCode)
	var conflict struct {
		Error string `json:"error"`
	}
	require.NoError(t, json.NewDecoder(second.Body).Decode(&conflict))
	second.Body.Close()
	require.Equal(t, "another import is already running; wait and retry", conflict.Error)
	require.Equal(t, int32(1), workbookOpens.Load(), "busy admission must not open or inflate another workbook")

	release <- struct{}{}
	require.Eventually(t, func() bool {
		job, ok := h.imports.get(firstJob.ID)
		return ok && job.State == ready && job.CompletedAt != nil
	}, time.Second, time.Millisecond)

	third, err := application.Test(multipartWorkbookRequest(t))
	require.NoError(t, err)
	require.Equal(t, fiber.StatusOK, third.StatusCode)
	third.Body.Close()
	<-started
	require.Equal(t, int32(2), workbookOpens.Load())
	release <- struct{}{}
}

func TestCreateTableRejectsOverExpandedWorkbookAndReleasesAdmission(t *testing.T) {
	workbook := excelize.NewFile()
	var normal bytes.Buffer
	require.NoError(t, workbook.Write(&normal))
	require.NoError(t, workbook.Close())

	reader, err := zip.NewReader(bytes.NewReader(normal.Bytes()), int64(normal.Len()))
	require.NoError(t, err)
	var expanded bytes.Buffer
	writer := zip.NewWriter(&expanded)
	for _, source := range reader.File {
		destination, createErr := writer.CreateHeader(&source.FileHeader)
		require.NoError(t, createErr)
		opened, openErr := source.Open()
		require.NoError(t, openErr)
		_, copyErr := io.Copy(destination, opened)
		require.NoError(t, copyErr)
		require.NoError(t, opened.Close())
	}
	payload, err := writer.Create("xl/oversized-payload.bin")
	require.NoError(t, err)
	_, err = io.CopyN(payload, zeroReader{}, workbookUnzipSizeLimit+1)
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	require.Less(t, expanded.Len(), 1<<20, "fixture must exercise compressed expansion, not request-body size")

	mailer := mailmemory.NewSender()
	h := &Handler{Handler: deps.New(&app.Container{Mail: mailer}), imports: newImportTracker(), openWorkbook: openWorkbook}
	var imports atomic.Int32
	h.importTable = func(*excelize.File, string, string, logging.Logger) (string, error) {
		imports.Add(1)
		return "", nil
	}
	application := fiber.New()
	application.Post("/create-table", func(c *fiber.Ctx) error {
		email := "admin@example.test"
		c.Locals("auth-master-user", infraauth.User{Login: "admin", Email: &email})
		return h.CreateTable(c)
	})

	response, err := application.Test(multipartWorkbookBytesRequest(t, expanded.Bytes()))
	require.NoError(t, err)
	require.Equal(t, fiber.StatusBadRequest, response.StatusCode)
	var body struct {
		Error string `json:"error"`
	}
	require.NoError(t, json.NewDecoder(response.Body).Decode(&body))
	require.NoError(t, response.Body.Close())
	require.Contains(t, body.Error, "over-expanded workbook")
	require.Zero(t, imports.Load(), "rejected archives must never reach the importer")

	h.imports.mu.RLock()
	require.Empty(t, h.imports.jobs, "a synchronous 400 has no import_id and must not retain unreachable status")
	h.imports.mu.RUnlock()
	next, accepted := h.imports.tryStart("next")
	require.True(t, accepted, "archive parse failure must release the import slot")
	h.imports.finish(next.ID, broken)
}

func TestCreateTableInvalidWorkbookFloodLeavesNoUnreachableJobs(t *testing.T) {
	h := &Handler{
		Handler:      deps.New(&app.Container{Mail: mailmemory.NewSender()}),
		imports:      newImportTracker(),
		openWorkbook: openWorkbook,
	}
	application := fiber.New()
	application.Post("/create-table", func(c *fiber.Ctx) error {
		email := "admin@example.test"
		c.Locals("auth-master-user", infraauth.User{Login: "admin", Email: &email})
		return h.CreateTable(c)
	})

	for range maxCompletedImportJobs * 2 {
		response, err := application.Test(multipartWorkbookBytesRequest(t, []byte("not an xlsx archive")))
		require.NoError(t, err)
		require.Equal(t, fiber.StatusBadRequest, response.StatusCode)
		require.NoError(t, response.Body.Close())
	}

	h.imports.mu.RLock()
	require.Empty(t, h.imports.jobs)
	h.imports.mu.RUnlock()
}

type zeroReader struct{}

func (zeroReader) Read(buffer []byte) (int, error) {
	return len(buffer), nil
}

func TestRunCreateTableRecordsEveryTerminalOutcomeAndRecoversPanic(t *testing.T) {
	for _, test := range []struct {
		name      string
		importer  func(*excelize.File, string, string, logging.Logger) (string, error)
		wantState importState
		secret    string
	}{
		{"success", func(*excelize.File, string, string, logging.Logger) (string, error) { return "ok", nil }, ready, ""},
		{"error", func(*excelize.File, string, string, logging.Logger) (string, error) {
			return "", errors.New("workbook rejected")
		}, broken, ""},
		{"panic", func(*excelize.File, string, string, logging.Logger) (string, error) { panic("panic-secret-value") }, broken, "panic-secret-value"},
	} {
		t.Run(test.name, func(t *testing.T) {
			mailer := mailmemory.NewSender()
			h := &Handler{Handler: deps.New(&app.Container{Mail: mailer}), imports: newImportTracker(), importTable: test.importer}
			job, accepted := h.imports.tryStart(test.name)
			require.True(t, accepted)
			h.runCreateTable(logging.RequestFields{}, excelize.NewFile(), "meta", "author@example.test", test.name, "fixture.xlsx", job.ID)
			terminal, ok := h.imports.get(job.ID)
			require.True(t, ok)
			require.Equal(t, test.wantState, terminal.State)
			require.NotNil(t, terminal.CompletedAt)
			next, accepted := h.imports.tryStart("next")
			require.True(t, accepted, "terminal outcome must release the per-process slot")
			h.imports.finish(next.ID, broken)
			require.Len(t, mailer.Messages, 1)
			if test.secret != "" {
				require.NotContains(t, mailer.Messages[0].Subject, test.secret)
				require.NotContains(t, mailer.Messages[0].Body, test.secret)
			}
		})
	}
}
