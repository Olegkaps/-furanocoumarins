package publicationreader

import (
	"bytes"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"

	reader "admin/internal/publicationreader"
	"github.com/gofiber/fiber/v2"
)

type Handler struct {
	analyzer *reader.Analyzer
	fetch    *http.Client
}

func New(enabled bool, key, model string) *Handler {
	return &Handler{reader.NewAnalyzer(enabled, key, model), reader.NewFetchClient()}
}

func (h *Handler) Status(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{
		"configured": h.analyzer.Configured(), "provider": "yandex",
		"warnings": []string{"Analysis requires an explicitly selected and configured Yandex Cloud API; consumer chat access does not configure an API. AI candidates require manual verification."},
		"limits":   fiber.Map{"source_bytes": reader.MaxSourceBytes, "text_bytes": reader.MaxTextBytes, "page_bytes": reader.MaxPageBytes, "pages": reader.MaxPages},
	})
}
func respondError(c *fiber.Ctx, err error) error {
	var e *reader.Error
	if errors.As(err, &e) {
		return c.Status(e.Status).JSON(fiber.Map{"error": e.Message})
	}
	return c.Status(500).JSON(fiber.Map{"error": "publication reader unavailable"})
}
func (h *Handler) Document(c *fiber.Ctx) error {
	if len(c.Body()) > reader.MaxSourceBytes+(64<<10) {
		return c.Status(413).JSON(fiber.Map{"error": "upload exceeds 8 MiB plus multipart overhead"})
	}
	media, params, err := mime.ParseMediaType(c.Get("Content-Type"))
	if err != nil {
		return c.Status(415).JSON(fiber.Map{"error": "use multipart/form-data or application/json"})
	}
	var doc reader.Document
	if media == "application/json" {
		var body struct {
			URL string `json:"url"`
		}
		if err := reader.DecodeJSON(c.Body(), &body); err != nil {
			return respondError(c, err)
		}
		doc, err = reader.Fetch(c.UserContext(), h.fetch, body.URL)
	} else if media == "multipart/form-data" {
		mr := multipart.NewReader(bytes.NewReader(c.Body()), params["boundary"])
		part, partErr := mr.NextPart()
		if partErr != nil || part.FormName() != "file" || part.FileName() == "" {
			return c.Status(400).JSON(fiber.Map{"error": "provide one multipart file field named file"})
		}
		data, readErr := reader.ReadBounded(part, reader.MaxSourceBytes)
		if readErr != nil {
			return respondError(c, readErr)
		}
		if _, extraErr := mr.NextPart(); extraErr != io.EOF {
			return c.Status(400).JSON(fiber.Map{"error": "provide exactly one file and no other multipart fields"})
		}
		contentType := part.Header.Get("Content-Type")
		if contentType == "" || contentType == "application/octet-stream" {
			switch strings.ToLower(filepath.Ext(part.FileName())) {
			case ".txt":
				contentType = "text/plain"
			case ".html", ".htm":
				contentType = "text/html"
			}
		}
		doc, err = reader.Extract(c.UserContext(), data, contentType, part.FileName())
	} else {
		return c.Status(415).JSON(fiber.Map{"error": "use multipart/form-data or application/json"})
	}
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(doc)
}
func (h *Handler) Analyze(c *fiber.Ctx) error {
	media, _, _ := mime.ParseMediaType(c.Get("Content-Type"))
	if media != "application/json" {
		return c.Status(415).JSON(fiber.Map{"error": "use application/json"})
	}
	var body struct {
		Document reader.Document `json:"document"`
	}
	if err := reader.DecodeJSON(c.Body(), &body); err != nil {
		return respondError(c, err)
	}
	if err := body.Document.Validate(); err != nil {
		return respondError(c, err)
	}
	result, err := h.analyzer.Analyze(c.UserContext(), body.Document)
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(result)
}
