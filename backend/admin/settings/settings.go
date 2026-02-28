package settings

import (
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/ilyakaznacheev/cleanenv"
	"github.com/redis/go-redis/v9"
	"github.com/redis/go-redis/v9/maintnotifications"
)

// envConfig хранит переменные окружения, загружаемые через cleanenv.
type envConfig struct {
	EnvType        string `env:"ENV_TYPE" env-default:"PROD"`
	SecretKey      string `env:"SECRET_KEY"`
	AllowOrigin    string `env:"ALLOW_ORIGIN"`
	PgUser         string `env:"PG_USER"`
	PgPassword     string `env:"PG_PASSWORD"`
	PgDb           string `env:"PG_DB"`
	RedisAddr      string `env:"REDIS_ADDR" env-default:"redis:6379"`
	RedisPassword  string `env:"REDIS_PASSWORD"`
	CassandraHost  string `env:"CASSANDRA_HOST"`
	DomainPref     string `env:"DOMAIN_PREF"`
	S3Endpoint     string `env:"S3_ENDPOINT"`
	S3AccessKey    string `env:"S3_ACCESS_KEY_ID"`
	S3SecretKey    string `env:"S3_SECRET_ACCESS_KEY"`
	S3Bucket       string `env:"S3_BUCKET"`
	S3Region       string `env:"S3_REGION" env-default:"us-east-1"`
	S3UsePathStyle bool   `env:"S3_USE_PATH_STYLE" env-default:"true"`
}


func mustLoadSettings() envConfig {
	var cfg envConfig
	if err := cleanenv.ReadEnv(&cfg); err != nil {
		panic(fmt.Sprintf("settings: read env: %v", err))
	}
	return cfg
}

var cfg = mustLoadSettings()

var BACK_VERSION = "v2.0"

var ENV_TYPE = cfg.EnvType

var SECRET_KEY = []byte(cfg.SecretKey)
var ALLOW_ORIGIN = cfg.AllowOrigin

var POSTGRES_SOURCE = fmt.Sprintf(
	"user=%s password=%s dbname=%s host=postgres port=5432 sslmode=disable",
	cfg.PgUser,
	cfg.PgPassword,
	cfg.PgDb,
)

var REDIS_SOURCE = &redis.Options{
	Addr:         cfg.RedisAddr,
	Password:     cfg.RedisPassword,
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

var CASSANDRA_HOST = cfg.CassandraHost
var CASSANDRA_COLLECTION_SEPARATORS = []rune{' ', '_'}

var DOMAIN_PREF = cfg.DomainPref

var S3_ENDPOINT = cfg.S3Endpoint
var S3_ACCESS_KEY = cfg.S3AccessKey
var S3_SECRET_KEY = cfg.S3SecretKey
var S3_BUCKET = cfg.S3Bucket
var S3_REGION = cfg.S3Region
var S3_USE_PATH_STYLE = cfg.S3UsePathStyle
