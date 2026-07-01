package persistence

import (
	"database/sql"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gocql/gocql"
	"github.com/redis/go-redis/v9"
)

// Clients holds shared infrastructure database connections.
type Clients struct {
	DB    *sql.DB
	Redis *redis.Client
	CQL   *gocql.ClusterConfig
	S3    *s3.Client
}
