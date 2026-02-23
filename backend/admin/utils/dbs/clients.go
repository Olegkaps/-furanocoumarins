package dbs

import (
	"context"
	"database/sql"

	"github.com/gocql/gocql"
	"github.com/redis/go-redis/v9"

	"admin/settings"
)

func mustLoadRedisClient() *redis.Client {
	if settings.ENV_TYPE == "AUTOTEST" {
		return nil
	}

	r := redis.NewClient(settings.REDIS_SOURCE)

	if err := r.Ping(context.Background()).Err(); err != nil {
		panic(err)
	}

	return r
}

var Redis *redis.Client = mustLoadRedisClient()

func mustLoadPostgres() *sql.DB {
	if settings.ENV_TYPE == "AUTOTEST" {
		return nil
	}

	db, err := sql.Open(
		"postgres",
		settings.POSTGRES_SOURCE,
	)

	if err != nil {
		panic(err)
	}

	return db
}

var DB *sql.DB = mustLoadPostgres()

func mustLoadCassandra() *gocql.ClusterConfig {
	return gocql.NewCluster(settings.CASSANDRA_HOST)
}

var CQL *gocql.ClusterConfig = mustLoadCassandra()
