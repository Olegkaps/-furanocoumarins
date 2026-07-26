package redis

import (
	"context"
	"errors"
	"time"

	goredis "github.com/redis/go-redis/v9"

	domainauth "admin/internal/domain/auth"
)

type MagicLinkStore struct {
	client *goredis.Client
}

func NewMagicLinkStore(client *goredis.Client) *MagicLinkStore {
	return &MagicLinkStore{client: client}
}

func (s *MagicLinkStore) Save(ctx context.Context, token, username string, ttl time.Duration) error {
	return s.client.SetEx(ctx, token, username, ttl).Err()
}

func (s *MagicLinkStore) Consume(ctx context.Context, token string) (string, error) {
	username, err := s.client.Get(ctx, token).Result()
	if err != nil {
		if errors.Is(err, goredis.Nil) {
			return "", domainauth.ErrTokenNotFound
		}
		return "", err
	}
	if err := s.client.Del(ctx, token).Err(); err != nil {
		return "", err
	}
	return username, nil
}

var _ domainauth.MagicLinkStore = (*MagicLinkStore)(nil)
