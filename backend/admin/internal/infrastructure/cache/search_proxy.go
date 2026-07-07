package cache

import (
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"

	domainsearch "admin/internal/domain/search"
)

// SearchReaderProxy caches metadata and search data (Proxy pattern).
type SearchReaderProxy struct {
	inner domainsearch.Reader
	cache Store

	mu               sync.RWMutex
	activeVersion    domainsearch.TableVersion
	activeVersionSet bool
}

func NewSearchReaderProxy(inner domainsearch.Reader, ttl time.Duration) *SearchReaderProxy {
	return &SearchReaderProxy{
		inner: inner,
		cache: NewMemoryStore(ttl),
	}
}

func NewSearchReaderProxyWithStore(inner domainsearch.Reader, store Store) *SearchReaderProxy {
	return &SearchReaderProxy{
		inner: inner,
		cache: store,
	}
}

func (p *SearchReaderProxy) SetActiveVersion(version domainsearch.TableVersion) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.activeVersion = version
	p.activeVersionSet = true
}

func (p *SearchReaderProxy) RefreshActiveVersion(c *fiber.Ctx) error {
	version, err := p.inner.ActiveTableVersion(c)
	if err != nil {
		return err
	}
	p.SetActiveVersion(version)
	return nil
}

func (p *SearchReaderProxy) ActiveTableVersion(c *fiber.Ctx) (domainsearch.TableVersion, error) {
	return p.currentActiveVersion(c)
}

func (p *SearchReaderProxy) FetchMetadata(c *fiber.Ctx) (*domainsearch.MetadataResponse, error) {
	version, err := p.currentActiveVersion(c)
	if err != nil {
		return nil, err
	}

	key := metadataCacheKey(version)
	if cached, ok := p.cache.Get(key); ok {
		return cached.(*domainsearch.MetadataResponse), nil
	}

	result, err := p.inner.FetchMetadata(c)
	if err != nil {
		return nil, err
	}

	p.cache.Set(key, result)
	return result, nil
}

func (p *SearchReaderProxy) FetchSearchData(
	c *fiber.Ctx,
	version domainsearch.TableVersion,
	query, selectClause string,
) ([]map[string]any, error) {
	key := searchCacheKey(version, query, selectClause)
	if cached, ok := p.cache.Get(key); ok {
		return cached.([]map[string]any), nil
	}

	data, err := p.inner.FetchSearchData(c, version, query, selectClause)
	if err != nil {
		return nil, err
	}

	p.cache.Set(key, data)
	return data, nil
}

func (p *SearchReaderProxy) currentActiveVersion(c *fiber.Ctx) (domainsearch.TableVersion, error) {
	p.mu.RLock()
	if p.activeVersionSet {
		version := p.activeVersion
		p.mu.RUnlock()
		return version, nil
	}
	p.mu.RUnlock()

	version, err := p.inner.ActiveTableVersion(c)
	if err != nil {
		return domainsearch.TableVersion{}, err
	}
	p.SetActiveVersion(version)
	return version, nil
}
