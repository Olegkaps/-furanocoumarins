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

// Config holds environment-backed application settings.
type Config struct {
	EnvType        string        `env:"ENV_TYPE" env-default:"PROD"`
	SecretKey      string        `env:"SECRET_KEY"`
	AllowOrigin    string        `env:"ALLOW_ORIGIN"`
	PgUser         string        `env:"PG_USER"`
	PgPassword     string        `env:"PG_PASSWORD"`
	PgDb           string        `env:"PG_DB"`
	PgHost         string        `env:"PG_HOST" env-default:"postgres"`
	PgPort         string        `env:"PG_PORT" env-default:"5432"`
	PgSSLMode      string        `env:"PG_SSLMODE" env-default:"disable"`
	RedisAddr      string        `env:"REDIS_ADDR" env-default:"redis:6379"`
	RedisPassword  string        `env:"REDIS_PASSWORD"`
	CassandraHost  string        `env:"CASSANDRA_HOST"`
	DomainPref     string        `env:"DOMAIN_PREF"`
	SmtpHost       string        `env:"SMTP_HOST" env-default:"smtp.yandex.ru"`
	SmtpPort       string        `env:"SMTP_PORT" env-default:"587"`
	Mail           string        `env:"MAIL"`
	MailSecret     string        `env:"MAIL_SECRET"`
	S3Endpoint     string        `env:"S3_ENDPOINT"`
	S3AccessKey    string        `env:"S3_ACCESS_KEY_ID"`
	S3SecretKey    string        `env:"S3_SECRET_ACCESS_KEY"`
	S3Bucket       string        `env:"S3_BUCKET"`
	S3Region       string        `env:"S3_REGION" env-default:"us-east-1"`
	S3UsePathStyle bool          `env:"S3_USE_PATH_STYLE" env-default:"true"`
	SearchCacheTTL time.Duration `env:"SEARCH_CACHE_TTL" env-default:"5m"`
}

// C is the loaded application configuration.
var C Config

func init() {
	if err := cleanenv.ReadEnv(&C); err != nil {
		panic(fmt.Sprintf("settings: read env: %v", err))
	}
}

const BackVersion = "v2.0"

var CassandraCollectionSeparators = []rune{' ', '_'}

func (c Config) SecretKeyBytes() []byte {
	return []byte(c.SecretKey)
}

func (c Config) PostgresDSN() string {
	return fmt.Sprintf(
		"user=%s password=%s dbname=%s host=%s port=%s sslmode=%s",
		c.PgUser,
		c.PgPassword,
		c.PgDb,
		c.PgHost,
		c.PgPort,
		c.PgSSLMode,
	)
}

func (c Config) RedisOptions() *redis.Options {
	return &redis.Options{
		Addr:         c.RedisAddr,
		Password:     c.RedisPassword,
		DB:           0,
		MaxRetries:   5,
		DialTimeout:  10 * time.Second,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
		MaintNotificationsConfig: &maintnotifications.Config{
			Mode: maintnotifications.ModeDisabled,
		},
	}
}

func (c Config) Cors() cors.Config {
	return cors.Config{
		AllowHeaders:     "Origin,Content-Type,Accept,Content-Length,Accept-Language,Accept-Encoding,Connection,Access-Control-Allow-Origin,Authorization",
		AllowOrigins:     c.AllowOrigin,
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
}
