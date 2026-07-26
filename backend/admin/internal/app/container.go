package app

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/gocql/gocql"
	"github.com/redis/go-redis/v9"

	appauth "admin/internal/application/auth"
	appsearch "admin/internal/application/search"
	domainauth "admin/internal/domain/auth"
	domainmail "admin/internal/domain/mail"
	domainuser "admin/internal/domain/user"
	inframailmemory "admin/internal/infrastructure/mail/memory"
	inframailsmtp "admin/internal/infrastructure/mail/smtp"
	"admin/internal/infrastructure/persistence"
	s3store "admin/internal/infrastructure/persistence/s3"
	infrapostgres "admin/internal/infrastructure/persistence/postgres"
	infraredis "admin/internal/infrastructure/persistence/redis"
	inframemory "admin/internal/infrastructure/persistence/memory"
	"admin/internal/infrastructure/persistence/cassandra"
	infracache "admin/internal/infrastructure/cache"
	"admin/internal/infrastructure/security"
	"admin/settings"
)

// Container wires all application layers and infrastructure adapters.
type Container struct {
	Auth        *appauth.Service
	Search      *appsearch.Service
	Mail        domainmail.Sender
	Users       domainuser.Repository
	Cassandra   *cassandra.Store
	Persistence *persistence.Clients
	EnvType     string
	Closer      func() error
}

type Options struct {
	PostgresDSN    string
	RedisOpts      *redis.Options
	CassandraHost  string
	SecretKey      []byte
	DomainPref     string
	EnvType        string
	Mail           domainmail.Sender
	Users          domainuser.Repository
	Links          domainauth.MagicLinkStore
	CassandraStore *cassandra.Store
}

func DefaultOptions() Options {
	return Options{
		PostgresDSN:   settings.C.PostgresDSN(),
		RedisOpts:     settings.C.RedisOptions(),
		CassandraHost: settings.C.CassandraHost,
		SecretKey:     settings.C.SecretKeyBytes(),
		DomainPref:    settings.C.DomainPref,
		EnvType:       settings.C.EnvType,
	}
}

func New(opts Options) (*Container, error) {
	c := &Container{
		Persistence: &persistence.Clients{},
		EnvType:     opts.EnvType,
	}

	if opts.EnvType == "AUTOTEST" || opts.EnvType == "TEST" {
		return newTestContainer(opts)
	}

	if opts.EnvType != "NODB" {
		db, err := sql.Open("postgres", opts.PostgresDSN)
		if err != nil {
			return nil, fmt.Errorf("open postgres: %w", err)
		}
		if err := db.PingContext(context.Background()); err != nil {
			return nil, fmt.Errorf("ping postgres: %w", err)
		}
		c.Persistence.DB = db

		rdb := redis.NewClient(opts.RedisOpts)
		if err := rdb.Ping(context.Background()).Err(); err != nil {
			return nil, fmt.Errorf("ping redis: %w", err)
		}
		c.Persistence.Redis = rdb
	}

	c.Persistence.CQL = gocql.NewCluster(opts.CassandraHost)
	if opts.CassandraStore != nil {
		c.Cassandra = opts.CassandraStore
	} else {
		c.Cassandra = cassandra.NewStore(c.Persistence.CQL)
	}

	s3Client, err := s3store.NewClient(opts.EnvType)
	if err != nil {
		return nil, fmt.Errorf("init s3: %w", err)
	}
	c.Persistence.S3 = s3Client

	mailSender := opts.Mail
	if mailSender == nil {
		mailSender = inframailsmtp.NewSender(inframailsmtp.ConfigFromSettings())
	}
	c.Mail = mailSender

	c.Closer = func() error {
		var err error
		if c.Persistence.DB != nil {
			err = c.Persistence.DB.Close()
		}
		if c.Persistence.Redis != nil {
			if closeErr := c.Persistence.Redis.Close(); closeErr != nil && err == nil {
				err = closeErr
			}
		}
		return err
	}

	c.Users, c.Auth = buildAuth(opts, c)
	c.Search = wireSearch(c.Cassandra)
	return c, nil
}

func wireSearch(store *cassandra.Store) *appsearch.Service {
	reader := cassandra.NewSearchReader(store)
	proxy := infracache.NewSearchReaderProxy(reader, settings.C.SearchCacheTTL)
	return appsearch.NewService(proxy, proxy)
}

func newTestContainer(opts Options) (*Container, error) {
	c := &Container{
		Persistence: &persistence.Clients{
			CQL: gocql.NewCluster("127.0.0.1"),
		},
		Mail:    inframailmemory.NewSender(),
		EnvType: opts.EnvType,
	}
	if opts.CassandraStore != nil {
		c.Cassandra = opts.CassandraStore
	} else {
		c.Cassandra = cassandra.NewStore(c.Persistence.CQL)
	}
	if opts.Mail != nil {
		c.Mail = opts.Mail
	}
	c.Users, c.Auth = buildAuth(opts, c)
	c.Search = wireSearch(c.Cassandra)
	c.Closer = func() error { return nil }
	return c, nil
}

func buildAuth(opts Options, c *Container) (domainuser.Repository, *appauth.Service) {
	var users domainuser.Repository
	switch {
	case opts.Users != nil:
		users = opts.Users
	case c.Persistence.DB != nil:
		users = infrapostgres.NewUserRepository(c.Persistence.DB)
	default:
		users = inframemory.NewUserRepository()
	}

	var links domainauth.MagicLinkStore
	switch {
	case opts.Links != nil:
		links = opts.Links
	case c.Persistence.Redis != nil:
		links = infraredis.NewMagicLinkStore(c.Persistence.Redis)
	default:
		links = inframemory.NewMagicLinkStore()
	}

	hasher := security.PasswordHasher{}
	tokens := security.NewTokenIssuer(opts.SecretKey)
	svc := appauth.NewService(users, links, c.Mail, hasher, tokens, opts.DomainPref)
	return users, svc
}
