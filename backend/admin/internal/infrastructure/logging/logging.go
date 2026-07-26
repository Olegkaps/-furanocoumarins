package logging

import (
	"fmt"
	"os"

	"github.com/gofiber/fiber/v2"
	"github.com/sirupsen/logrus"
)

// Logger is used for request-scoped and async logging.
type Logger interface {
	Debug(format string, a ...any)
	Info(format string, a ...any)
	Warn(format string, a ...any)
	Error(format string, a ...any)
}

// RequestFields holds request-scoped log fields copied before async handler work.
type RequestFields logrus.Fields

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

func CopyRequestFields(c *fiber.Ctx) RequestFields {
	return RequestFields(getFields(c))
}

func (f RequestFields) Debug(format string, a ...any) {
	logrus.WithFields(logrus.Fields(f)).Debug(fmt.Sprintf(format, a...))
}

func (f RequestFields) Info(format string, a ...any) {
	logrus.WithFields(logrus.Fields(f)).Info(fmt.Sprintf(format, a...))
}

func (f RequestFields) Warn(format string, a ...any) {
	logrus.WithFields(logrus.Fields(f)).Warn(fmt.Sprintf(format, a...))
}

func (f RequestFields) Error(format string, a ...any) {
	logrus.WithFields(logrus.Fields(f)).Error(fmt.Sprintf(format, a...))
}

func Debug(c *fiber.Ctx, format string, a ...any) {
	CopyRequestFields(c).Debug(format, a...)
}

func Info(c *fiber.Ctx, format string, a ...any) {
	CopyRequestFields(c).Info(format, a...)
}

func Warn(c *fiber.Ctx, format string, a ...any) {
	CopyRequestFields(c).Warn(format, a...)
}

func Error(c *fiber.Ctx, format string, a ...any) {
	CopyRequestFields(c).Error(format, a...)
}

func Fatal(format string, a ...any) {
	logrus.Fatal(fmt.Sprintf(format, a...))
	os.Exit(1)
}

// Nop is a no-op logger for tests.
type Nop struct{}

func (Nop) Debug(string, ...any) {}
func (Nop) Info(string, ...any)  {}
func (Nop) Warn(string, ...any)  {}
func (Nop) Error(string, ...any) {}

var (
	_ Logger = RequestFields{}
	_ Logger = Nop{}
)
