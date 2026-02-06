package http

import (
	"admin/utils/logging"
	"errors"

	"github.com/gofiber/fiber/v2"
)

func Resp500(c *fiber.Ctx, err error) error {
	logging.Error(c, "%s", err.Error())
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
		"error": err.Error(),
	})
}

func Resp400(c *fiber.Ctx, err error) error {
	logging.Warn(c, "%s", err.Error())
	return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
		"error": err.Error(),
	})
}

func Resp401(c *fiber.Ctx) error {
	logging.Error(c, "Unauthorized")
	return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
		"error": "unauthorized",
	})
}

func Resp404(c *fiber.Ctx) error {
	logging.Warn(c, "not found")
	return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
		"error": "not found",
	})
}

func RespErr(c *fiber.Ctx, err error) error {
	var err400 *UserError
	if errors.As(err, &err400) {
		return Resp400(c, err)
	}
	return Resp500(c, err)
}

func Resp200(c *fiber.Ctx) error {
	logging.Info(c, "sending ok")
	return c.SendStatus(fiber.StatusOK)
}

func JSON(c *fiber.Ctx, data any) error {
	logging.Info(c, "sending ok with json")
	return c.JSON(data)
}
