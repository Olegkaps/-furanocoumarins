package dbs

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"admin/settings"
	"admin/utils/common"
)

func NewRedisClient(ctx context.Context) (*redis.Client, error) {
	db := redis.NewClient(settings.REDIS_SOURCE)

	if err := db.Ping(ctx).Err(); err != nil {
		common.WriteLog("failed to connect to redis server: %s", err.Error())
		return nil, err
	}

	return db, nil
}

func OpenDB() (*sql.DB, error) {
	return sql.Open(
		"postgres",
		settings.POSTGRES_SOURCE,
	)
}

func FixCassandraTimestamp(s string) string {
	s = strings.ReplaceAll(s, "-", "_")
	s = strings.ReplaceAll(s, ":", "_")
	s = strings.ReplaceAll(s, ".", "_")

	return s
}

func String2Time(s string) (time.Time, error) {
	t, err := time.Parse("2006-01-02T15:04:05.000Z", s)
	if err != nil {
		t, err = time.Parse("2006-01-02T15:04:05.00Z", s)
		if err != nil {
			common.WriteLog(err.Error())
			return time.Time{}, err
		}
	}
	return t, nil
}
