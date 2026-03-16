package pages

import (
	"context"
	"fmt"
	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gofiber/fiber/v2"

	"admin/settings"
	"admin/utils/dbs"
	"admin/utils/dbs/cassandra"
	"admin/utils/http"
	"admin/utils/logging"
)

// Get_page godoc
// @Summary      Get page content by name
// @Description  Returns markdown content of a page from S3
// @Tags         pages
// @Param        name path string true "Page name"
// @Produce      text/markdown
// @Success      200 {string} string "Markdown content"
// @Failure      400,404,500 {object} http.ErrorResponse
// @Router       /pages/{name} [get]
func Get_page(c *fiber.Ctx) error {
	name := c.Params("name")
	if name == "" {
		return http.Resp400(c, fmt.Errorf("name is required"))
	}

	session, err := dbs.CQL.CreateSession()
	if err != nil {
		return http.Resp500(c, err)
	}
	defer session.Close()

	s3Key, err := cassandra.GetPageKey(session, name)
	if err != nil {
		return http.RespErr(c, err)
	}
	if s3Key == "" {
		return http.Resp404(c)
	}

	out, err := dbs.S3Client.GetObject(context.Background(), &s3.GetObjectInput{
		Bucket: aws.String(settings.S3_BUCKET),
		Key:    aws.String(s3Key),
	})
	if err != nil {
		return http.Resp500(c, err)
	}
	defer func(c *fiber.Ctx) {
		err := out.Body.Close()
		if err != nil {
			logging.Error(c, "%s", err)
		}
	}(c)

	body, err := io.ReadAll(out.Body)
	if err != nil {
		return http.Resp500(c, err)
	}

	c.Set("Content-Type", "text/markdown; charset=utf-8")
	return c.Send(body)
}
