package auth

import (
	"context"
	"time"
)

// MagicLinkStore persists one-time tokens for passwordless login and password reset.
type MagicLinkStore interface {
	Save(ctx context.Context, token, username string, ttl time.Duration) error
	Consume(ctx context.Context, token string) (username string, err error)
}
