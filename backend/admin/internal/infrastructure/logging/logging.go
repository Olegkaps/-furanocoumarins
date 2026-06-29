package logging

import (
	"fmt"
	"os"

	"github.com/gofiber/fiber/v2"
	"github.com/sirupsen/logrus"
)

func getFields(c *fiber.Ctx) logrus.Fields {
	r := c.Route()
	return logrus.Fields{
		"request-id": c.Context().ID(),
		"ip":         c.IP(),
		"route": logrus.Fields{
			"method": r.Method,
			"name":   r.Name,
			"path":   r.Path,
			"params": r.Params,
		},
	}
}

func Debug(c *fiber.Ctx, format string, a ...any) {
	message := fmt.Sprintf(format, a...)
	fields := getFields(c)

	logrus.WithFields(fields).Debug(message)
}

func Info(c *fiber.Ctx, format string, a ...any) {
	message := fmt.Sprintf(format, a...)
	fields := getFields(c)

	logrus.WithFields(fields).Info(message)
}

func Warn(c *fiber.Ctx, format string, a ...any) {
	message := fmt.Sprintf(format, a...)
	fields := getFields(c)

	logrus.WithFields(fields).Warn(message)
}

func Error(c *fiber.Ctx, format string, a ...any) {
	message := fmt.Sprintf(format, a...)
	fields := getFields(c)

	logrus.WithFields(fields).Error(message)
}

func Fatal(format string, a ...any) {
	message := fmt.Sprintf(format, a...)

	logrus.Fatal(message)
	os.Exit(1)
}
