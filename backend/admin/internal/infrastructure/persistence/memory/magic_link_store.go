package memory

import (
	"context"
	"sync"
	"time"

	domainauth "admin/internal/domain/auth"
)

type entry struct {
	username  string
	expiresAt time.Time
}

// MagicLinkStore is an in-memory MagicLinkStore for unit tests.
type MagicLinkStore struct {
	mu    sync.Mutex
	items map[string]entry
}

func NewMagicLinkStore() *MagicLinkStore {
	return &MagicLinkStore{items: make(map[string]entry)}
}

func (s *MagicLinkStore) Save(_ context.Context, token, username string, ttl time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[token] = entry{username: username, expiresAt: time.Now().Add(ttl)}
	return nil
}

func (s *MagicLinkStore) Consume(_ context.Context, token string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	item, ok := s.items[token]
	if !ok || time.Now().After(item.expiresAt) {
		return "", domainauth.ErrTokenNotFound
	}
	delete(s.items, token)
	return item.username, nil
}

var _ domainauth.MagicLinkStore = (*MagicLinkStore)(nil)
