package settings

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/redis/go-redis/v9"
	"github.com/redis/go-redis/v9/maintnotifications"
)

var BACK_VERSION = "v2.0"

var SECRET_KEY = []byte(os.Getenv("SECRET_KEY"))
var ALLOW_ORIGIN = os.Getenv("ALLOW_ORIGIN")

var POSTGRES_SOURCE = fmt.Sprintf(
	"user=%s password=%s dbname=%s host=postgres port=5432 sslmode=disable",
	os.Getenv("PG_USER"),
	os.Getenv("PG_PASSWORD"),
	os.Getenv("PG_DB"),
)

var REDIS_SOURCE = &redis.Options{
	Addr:         "redis:6379",
	Password:     os.Getenv("REDIS_PASSWORD"),
	DB:           0,
	MaxRetries:   5,
	DialTimeout:  10 * time.Second,
	ReadTimeout:  5 * time.Second,
	WriteTimeout: 5 * time.Second,
	MaintNotificationsConfig: &maintnotifications.Config{
		Mode: maintnotifications.ModeDisabled,
	},
}

var CORS_SETTINGS = cors.Config{
	AllowHeaders:     "Origin,Content-Type,Accept,Content-Length,Accept-Language,Accept-Encoding,Connection,Access-Control-Allow-Origin,Authorization",
	AllowOrigins:     ALLOW_ORIGIN,
	AllowOriginsFunc: nil,
	AllowCredentials: false,
	AllowMethods: strings.Join([]string{
		fiber.MethodGet,
		fiber.MethodPost,
		fiber.MethodHead,
		fiber.MethodPut,
		fiber.MethodDelete,
		fiber.MethodPatch,
	}, ","),
	MaxAge: 3600,
}

var CASSANDRA_HOST = os.Getenv("CASSANDRA_HOST")
var CASSANDRA_COLLECTION_SEPARATORS = []rune{' ', '_'}

var DOMAIN_PREF = os.Getenv("DOMAIN_PREF")
