package cache

import (
	"context"
	"sync"
	"time"
)

type cacheEntry struct {
	value     any
	expiresAt time.Time
}

// MemoryStore is a thread-safe in-memory TTL cache with periodic eviction.
type MemoryStore struct {
	mu              sync.RWMutex
	items           map[string]cacheEntry
	ttl             time.Duration
	cleanupInterval time.Duration
	cancel          context.CancelFunc
}

func NewMemoryStore(ttl time.Duration) *MemoryStore {
	cleanupInterval := ttl / 2
	if cleanupInterval <= 0 {
		cleanupInterval = time.Second
	}

	ctx, cancel := context.WithCancel(context.Background())
	s := &MemoryStore{
		items:           make(map[string]cacheEntry),
		ttl:             ttl,
		cleanupInterval: cleanupInterval,
		cancel:          cancel,
	}
	go s.runCleanup(ctx)
	return s
}

func (s *MemoryStore) Get(key string) (any, bool) {
	s.mu.RLock()
	entry, ok := s.items[key]
	s.mu.RUnlock()
	if !ok || time.Now().After(entry.expiresAt) {
		return nil, false
	}
	return entry.value, true
}

func (s *MemoryStore) Set(key string, value any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[key] = cacheEntry{
		value:     value,
		expiresAt: time.Now().Add(s.ttl),
	}
}

func (s *MemoryStore) Close() error {
	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}
	return nil
}

func (s *MemoryStore) runCleanup(ctx context.Context) {
	ticker := time.NewTicker(s.cleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.evictExpired()
		}
	}
}

func (s *MemoryStore) evictExpired() {
	now := time.Now()

	s.mu.RLock()
	expired := make([]string, 0)
	for key, entry := range s.items {
		if now.After(entry.expiresAt) {
			expired = append(expired, key)
		}
	}
	s.mu.RUnlock()

	if len(expired) == 0 {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for _, key := range expired {
		if entry, ok := s.items[key]; ok && now.After(entry.expiresAt) {
			delete(s.items, key)
		}
	}
}
