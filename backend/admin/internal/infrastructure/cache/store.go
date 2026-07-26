package cache

// Store is a TTL cache backend (memory, Redis, etc.).
type Store interface {
	Get(key string) (any, bool)
	Set(key string, value any)
	Close() error
}

var _ Store = (*MemoryStore)(nil)
