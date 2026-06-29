package pages

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"unicode/utf8"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"

	"admin/internal/app"
	"admin/internal/infrastructure/logging"
	"admin/internal/presentation/http/deps"
	"admin/internal/presentation/http/response"
	"admin/settings"
)

const maxPageRunes = 10_000

type Handler struct {
	deps.Handler
}

func NewHandler(container *app.Container) *Handler {
	return &Handler{Handler: deps.New(container)}
}

// Get_page godoc
// @Summary      Get page content by name
// @Description  Returns markdown content of a page from S3
// @Tags         pages
// @Param        name path string true "Page name"
// @Produce      text/markdown
// @Success      200 {string} string "Markdown content"
// @Failure      400,404,500 {object} response.ErrorResponse
// @Router       /pages/{name} [get]
func (h *Handler) Get_page(c *fiber.Ctx) error {
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
		Bucket: aws.String(settings.S3_BUCKET),
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

// Put_page godoc
// @Summary      Create or update page
// @Description  Uploads markdown content for a page (admin only)
// @Tags         pages
// @Security     BearerAuth
// @Param        name path string true "Page name"
// @Param        body body string true "Markdown content"
// @Accept       application/octet-stream
// @Produce      json
// @Success      200
// @Failure      400,401,500 {object} response.ErrorResponse
// @Router       /pages/{name} [put]
func (h *Handler) Put_page(c *fiber.Ctx) error {
	user := c.Locals("user").(*jwt.Token)
	claims := user.Claims.(jwt.MapClaims)
	role, _ := claims["role"].(string)
	if role != "admin" {
		return response.Resp401(c, nil)
	}

	name := c.Params("name")
	if name == "" {
		return response.Resp400(c, fmt.Errorf("name is required"))
	}

	body := c.Body()
	if utf8.RuneCount(body) > maxPageRunes {
		return response.Resp400(c, fmt.Errorf("content exceeds %d characters", maxPageRunes))
	}

	ctx := context.Background()
	key := "pages/" + name + ".md"

	_, err := h.Container.Persistence.S3.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(settings.S3_BUCKET),
		Key:         aws.String(key),
		Body:        bytes.NewReader(body),
		ContentType: aws.String("text/markdown; charset=utf-8"),
	})
	if err != nil {
		logging.Error(c, "S3 PutObject: %v", err)
		return response.Resp500(c, err)
	}

	if err := h.Container.Cassandra.SetPageKey(name, key); err != nil {
		return response.RespErr(c, err)
	}
	return response.Resp200(c)
}
