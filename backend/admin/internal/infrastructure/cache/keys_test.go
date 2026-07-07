package cache

import (
	"testing"
	"time"

	domainsearch "admin/internal/domain/search"
)

func TestNormalizeSelectClauseIgnoresOrder(t *testing.T) {
	version := domainsearch.TableVersion{
		Timestamp: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		Version:   "v2",
	}

	keyA := searchCacheKey(version, "name = 'a'", "name, surname")
	keyB := searchCacheKey(version, "name = 'a'", "surname, name")

	if keyA != keyB {
		t.Fatalf("expected equal cache keys, got %q and %q", keyA, keyB)
	}
}
