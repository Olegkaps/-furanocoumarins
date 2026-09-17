package pages

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gofiber/fiber/v2"

	"admin/internal/app"
	"admin/internal/infrastructure/logging"
	"admin/internal/presentation/http/deps"
	"admin/internal/presentation/http/response"
	"admin/settings"
)

const maxPageRunes = 10_000

const aboutPagesCatalogName = "about-subpages"

var aboutPageID = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,47}$`)

var aboutPageIcons = map[string]bool{
	"info": true, "book": true, "document": true,
	"flask": true, "leaf": true, "table": true,
}

// AboutPage is the public navigation data for one admin-authored About subpage.
// Its markdown is stored through the ordinary pages endpoint under PageName.
type AboutPage struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon"`
}

type aboutPagesCatalog struct {
	Pages []AboutPage `json:"pages"`
}

type Handler struct {
	deps.Handler
}

func NewHandler(container *app.Container) *Handler {
	return &Handler{Handler: deps.New(container)}
}

// GetPage godoc
// @Summary      Get page content by name
// @Description  Returns markdown content of a page from S3
// @Tags         pages
// @Param        name path string true "Page name" example(about)
// @Produce      text/markdown
// @Success      200 {string} string "Markdown content"
// @Failure      400,404,500 {object} response.ErrorResponse
// @Router       /pages/{name} [get]
func (h *Handler) GetPage(c *fiber.Ctx) error {
	name := c.Params("name")
	if name == "" {
		return response.Resp400(c, fmt.Errorf("name is required"))
	}

	s3Key, err := h.Container.Cassandra.GetPageKey(name)
	if err != nil {
		return response.RespErr(c, err)
	}
	if s3Key == "" {
		return response.Resp404(c)
	}

	out, err := h.Container.Persistence.S3.GetObject(context.Background(), &s3.GetObjectInput{
		Bucket: aws.String(settings.C.S3Bucket),
		Key:    aws.String(s3Key),
	})
	if err != nil {
		return response.Resp500(c, err)
	}
	defer func(c *fiber.Ctx) {
		if err := out.Body.Close(); err != nil {
			logging.Error(c, "%s", err)
		}
	}(c)

	body, err := io.ReadAll(out.Body)
	if err != nil {
		return response.Resp500(c, err)
	}

	c.Set("Content-Type", "text/markdown; charset=utf-8")
	return c.Send(body)
}

// GetAboutPages returns the public About subpage navigation. A site without a
// catalog is a valid legacy site and simply has no subpages.
func (h *Handler) GetAboutPages(c *fiber.Ctx) error {
	catalog, found, err := h.getAboutPages(context.Background())
	if err != nil {
		return response.RespErr(c, err)
	}
	if !found {
		return c.JSON(aboutPagesCatalog{Pages: []AboutPage{}})
	}
	return c.JSON(catalog)
}

// PutAboutPages replaces the small public navigation catalog (admin only).
// Markdown remains independently editable through the existing page API.
func (h *Handler) PutAboutPages(c *fiber.Ctx) error {
	var catalog aboutPagesCatalog
	if err := json.Unmarshal(c.Body(), &catalog); err != nil {
		return response.Resp400(c, fmt.Errorf("invalid About subpages: %w", err))
	}
	if err := validateAboutPages(catalog.Pages); err != nil {
		return response.Resp400(c, err)
	}
	body, err := json.Marshal(catalog)
	if err != nil {
		return response.Resp500(c, err)
	}
	if err := h.putPage(context.Background(), aboutPagesCatalogName, "pages/about-subpages.json", body, "application/json; charset=utf-8"); err != nil {
		return response.RespErr(c, err)
	}
	return c.JSON(catalog)
}

// PutPage godoc
// @Summary      Create or update page
// @Description  Uploads markdown content for a page (admin only)
// @Tags         pages
// @Security     BearerAuth
// @Param        name path string true "Page name" example(about)
// @Param        body body string true "Markdown content" example(# About\n\nPlatform for furanocoumarins analysis.)
// @Accept       application/octet-stream
// @Produce      json
// @Success      200
// @Failure      400,401,500 {object} response.ErrorResponse
// @Router       /pages/{name} [put]
func (h *Handler) PutPage(c *fiber.Ctx) error {
	name := c.Params("name")
	if name == "" {
		return response.Resp400(c, fmt.Errorf("name is required"))
	}

	body := c.Body()
	if utf8.RuneCount(body) > maxPageRunes {
		return response.Resp400(c, fmt.Errorf("content exceeds %d characters", maxPageRunes))
	}

	if err := h.putPage(context.Background(), name, "pages/"+name+".md", body, "text/markdown; charset=utf-8"); err != nil {
		return response.RespErr(c, err)
	}
	return response.Resp200(c)
}

func (h *Handler) getAboutPages(ctx context.Context) (aboutPagesCatalog, bool, error) {
	key, err := h.Container.Cassandra.GetPageKey(aboutPagesCatalogName)
	if err != nil {
		return aboutPagesCatalog{}, false, err
	}
	if key == "" {
		return aboutPagesCatalog{}, false, nil
	}
	out, err := h.Container.Persistence.S3.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(settings.C.S3Bucket), Key: aws.String(key)})
	if err != nil {
		return aboutPagesCatalog{}, false, err
	}
	defer out.Body.Close()
	body, err := io.ReadAll(out.Body)
	if err != nil {
		return aboutPagesCatalog{}, false, err
	}
	var catalog aboutPagesCatalog
	if err := json.Unmarshal(body, &catalog); err != nil {
		return aboutPagesCatalog{}, false, fmt.Errorf("invalid stored About subpages: %w", err)
	}
	if err := validateAboutPages(catalog.Pages); err != nil {
		return aboutPagesCatalog{}, false, fmt.Errorf("invalid stored About subpages: %w", err)
	}
	return catalog, true, nil
}

func (h *Handler) putPage(ctx context.Context, name, key string, body []byte, contentType string) error {
	_, err := h.Container.Persistence.S3.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(settings.C.S3Bucket), Key: aws.String(key), Body: bytes.NewReader(body), ContentType: aws.String(contentType),
	})
	if err != nil {
		return err
	}
	return h.Container.Cassandra.SetPageKey(name, key)
}

func validateAboutPages(pages []AboutPage) error {
	if len(pages) > 15 {
		return fmt.Errorf("at most 15 About subpages are allowed")
	}
	seen := make(map[string]bool, len(pages))
	for _, page := range pages {
		if !aboutPageID.MatchString(page.ID) || strings.TrimSpace(page.Name) == "" || len([]rune(page.Name)) > 80 || !aboutPageIcons[page.Icon] || seen[page.ID] {
			return fmt.Errorf("each About subpage needs a unique id, supported icon, and a name up to 80 characters")
		}
		seen[page.ID] = true
	}
	return nil
}
