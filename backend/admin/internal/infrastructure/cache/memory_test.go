package cache_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"admin/internal/infrastructure/cache"
)

func TestMemoryStoreTTLPositive(t *testing.T) {
	store := cache.NewMemoryStore(time.Hour)
	t.Cleanup(func() { _ = store.Close() })

	store.Set("key", "value")
	got, ok := store.Get("key")
	require.True(t, ok)
	assert.Equal(t, "value", got)
}

func TestMemoryStoreBackgroundEvictionNegative(t *testing.T) {
	ttl := 30 * time.Millisecond
	store := cache.NewMemoryStore(ttl)
	t.Cleanup(func() { _ = store.Close() })

	store.Set("key", "value")
	time.Sleep(ttl + ttl/2)

	_, ok := store.Get("key")
	assert.False(t, ok)
}
