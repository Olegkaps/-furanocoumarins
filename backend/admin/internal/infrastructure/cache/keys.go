package cache

import (
	"fmt"
	"slices"
	"strings"
	"time"

	domainsearch "admin/internal/domain/search"
)

func metadataCacheKey(version domainsearch.TableVersion) string {
	return fmt.Sprintf("metadata|%s|%s",
		version.Timestamp.UTC().Format(time.RFC3339Nano),
		version.Version,
	)
}

func searchCacheKey(version domainsearch.TableVersion, query, selectClause string) string {
	return fmt.Sprintf("search|%s|%s|%s|%s",
		version.Timestamp.UTC().Format(time.RFC3339Nano),
		version.Version,
		normalizeSelectClause(selectClause),
		query,
	)
}

func normalizeSelectClause(selectClause string) string {
	if selectClause == "" {
		return ""
	}
	parts := strings.Split(selectClause, ", ")
	slices.Sort(parts)
	return strings.Join(parts, ", ")
}
