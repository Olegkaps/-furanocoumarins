package http

import (
	"admin/utils/logging"
	"errors"

	"github.com/gofiber/fiber/v2"
)

// ErrorResponse is the JSON body for 4xx/5xx responses
type ErrorResponse struct {
	Error string `json:"error" example:"error message"`
}

// TokenResponse is the JSON body for login/renew-token endpoints
type TokenResponse struct {
	Token string `json:"token" example:"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."`
}

// ArticleValResponse is the JSON body for get article endpoint
type ArticleValResponse struct {
	Val string `json:"val" example:"@article{key2024,\n  author = {Smith, J.},\n  title = {Title},\n  year = {2024}\n}"`
}

func Resp500(c *fiber.Ctx, err error) error {
	logging.Error(c, "%s", err.Error())
	return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
}

func Resp400(c *fiber.Ctx, err error) error {
	logging.Warn(c, "%s", err.Error())
	return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: err.Error()})
}

func Resp401(c *fiber.Ctx, err error) error {
	if err != nil {
		logging.Error(c, "Unauthorized: %s", err.Error())
	} else {
		logging.Error(c, "Unauthorized")
	}
	return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "unauthorized"})
}

func Resp404(c *fiber.Ctx) error {
	logging.Warn(c, "not found")
	return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "not found"})
}

func RespErr(c *fiber.Ctx, err error) error {
	var err400 *UserError
	if errors.As(err, &err400) {
		return Resp400(c, err)
	}
	return Resp500(c, err)
}

// Resp200 godoc
// @Summary      Health check ping
// @Description  Returns 200 OK for liveness/readiness checks
// @Tags         health
// @Success      200
// @Router       /ping [get]
func Resp200(c *fiber.Ctx) error {
	logging.Info(c, "sending ok")
	return c.SendStatus(fiber.StatusOK)
}

func JSON(c *fiber.Ctx, data any) error {
	logging.Info(c, "sending ok with json")
	return c.JSON(data)
}
