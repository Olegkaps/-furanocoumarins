package dbs

import (
	"admin/utils/logging"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

func FixCassandraTimestamp(s string) string {
	s = strings.ReplaceAll(s, "-", "_")
	s = strings.ReplaceAll(s, ":", "_")
	s = strings.ReplaceAll(s, ".", "_")

	return s
}

func String2Time(c *fiber.Ctx, s string) (time.Time, error) {
	t, err := time.Parse("2006-01-02T15:04:05.000Z", s)
	if err != nil {
		t, err = time.Parse("2006-01-02T15:04:05.00Z", s)
		if err != nil {
			logging.Warn(c, "%s", err.Error())
			return time.Time{}, err
		}
	}
	return t, nil
}
