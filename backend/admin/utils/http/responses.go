package http

import (
	"admin/utils/common"
	"errors"

	"github.com/gofiber/fiber/v2"
)

func Resp500(c *fiber.Ctx, err error) error {
	common.WriteLog(err.Error())
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
		"error": err.Error(),
	})
}

func Resp400(c *fiber.Ctx, err error) error {
	common.WriteLog(err.Error())
	return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
		"error": err.Error(),
	})
}

func Resp401(c *fiber.Ctx) error {
	common.WriteLog("Unauthorized")
	return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
		"error": "unauthorized",
	})
}

func RespErr(c *fiber.Ctx, err error) error {
	var err400 *UserError
	if errors.As(err, &err400) {
		return Resp400(c, err)
	}
	return Resp500(c, err)
}
