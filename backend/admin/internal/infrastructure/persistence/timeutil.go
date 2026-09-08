package persistence

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"admin/internal/infrastructure/logging"
)

func FixCassandraTimestamp(s string) string {
	s = strings.ReplaceAll(s, "-", "_")
	s = strings.ReplaceAll(s, ":", "_")
	s = strings.ReplaceAll(s, ".", "_")
	return s
}

func String2Time(c *fiber.Ctx, s string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		logging.Warn(c, "%s", err.Error())
		return time.Time{}, err
	}
	return t, nil
}
