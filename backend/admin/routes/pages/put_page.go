package pages

import (
	"bytes"
	"context"
	"fmt"
	"unicode/utf8"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"

	"admin/settings"
	"admin/utils/dbs"
	"admin/utils/dbs/cassandra"
	"admin/utils/http"
	"admin/utils/logging"
)

const maxPageRunes = 10_000

func Put_page(c *fiber.Ctx) error {
	user := c.Locals("user").(*jwt.Token)
	claims := user.Claims.(jwt.MapClaims)
	role, _ := claims["role"].(string)
	if role != "admin" {
		return http.Resp401(c, nil)
	}

	name := c.Params("name")
	if name == "" {
		return http.Resp400(c, fmt.Errorf("name required"))
	}

	body := c.Body()
	if utf8.RuneCount(body) > maxPageRunes {
		return http.Resp400(c, fmt.Errorf("content exceeds %d characters", maxPageRunes))
	}

	ctx := context.Background()

	bucket := settings.S3_BUCKET
	key := "pages/" + name + ".md"

	_, err := dbs.S3Client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(body),
		ContentType: aws.String("text/markdown; charset=utf-8"),
	})
	if err != nil {
		logging.Error(c, "S3 PutObject: %v", err)
		return http.Resp500(c, err)
	}

	session, err := dbs.CQL.CreateSession()
	if err != nil {
		return http.Resp500(c, err)
	}
	defer session.Close()

	if err := cassandra.SetPageKey(session, name, key); err != nil {
		return http.RespErr(c, err)
	}

	return http.Resp200(c)
}
