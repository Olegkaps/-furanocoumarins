package cache_test

import (
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	domainsearch "admin/internal/domain/search"
	"admin/internal/infrastructure/cache"
)

type stubSearchReader struct {
	version       domainsearch.TableVersion
	metadata      *domainsearch.MetadataResponse
	searchData    []map[string]any
	metadataCalls int
	searchCalls   int
}

func (s *stubSearchReader) ActiveTableVersion(_ *fiber.Ctx) (domainsearch.TableVersion, error) {
	return s.version, nil
}

func (s *stubSearchReader) FetchMetadata(_ *fiber.Ctx) (*domainsearch.MetadataResponse, error) {
	s.metadataCalls++
	return s.metadata, nil
}

func (s *stubSearchReader) FetchSearchData(
	_ *fiber.Ctx,
	_ domainsearch.TableVersion,
	_, _ string,
) ([]map[string]any, error) {
	s.searchCalls++
	return s.searchData, nil
}

func TestSearchReaderProxyMetadataCachePositive(t *testing.T) {
	version := domainsearch.TableVersion{
		Timestamp: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		Version:   "v2",
		TableData: "chemdb.data_test",
	}
	inner := &stubSearchReader{
		version: version,
		metadata: &domainsearch.MetadataResponse{
			Metadata:       []domainsearch.ColumnMeta{{Column: "name", Type: "text"}},
			TableTimestamp: version.Timestamp,
		},
	}
	proxy := cache.NewSearchReaderProxy(inner, time.Hour)
	proxy.SetActiveVersion(version)

	first, err := proxy.FetchMetadata(nil)
	require.NoError(t, err)
	second, err := proxy.FetchMetadata(nil)
	require.NoError(t, err)

	assert.Equal(t, 1, inner.metadataCalls)
	assert.Equal(t, first, second)
}

func TestSearchReaderProxySearchCachePositive(t *testing.T) {
	version := domainsearch.TableVersion{
		Timestamp: time.Date(2026, 2, 3, 4, 5, 6, 0, time.UTC),
		Version:   "v2",
		TableData: "chemdb.data_test",
	}
	inner := &stubSearchReader{
		version:    version,
		searchData: []map[string]any{{"name": "alice"}},
	}
	proxy := cache.NewSearchReaderProxy(inner, time.Hour)
	proxy.SetActiveVersion(version)

	_, err := proxy.FetchSearchData(nil, version, "name = 'alice'", "name")
	require.NoError(t, err)
	_, err = proxy.FetchSearchData(nil, version, "name = 'alice'", "name")
	require.NoError(t, err)

	assert.Equal(t, 1, inner.searchCalls)
}

func TestSearchReaderProxyIgnoresSelectColumnOrder(t *testing.T) {
	version := domainsearch.TableVersion{
		Timestamp: time.Date(2026, 2, 4, 0, 0, 0, 0, time.UTC),
		Version:   "v2",
		TableData: "chemdb.data_test",
	}
	inner := &stubSearchReader{
		version:    version,
		searchData: []map[string]any{{"name": "alice", "surname": "x"}},
	}
	proxy := cache.NewSearchReaderProxy(inner, time.Hour)
	proxy.SetActiveVersion(version)

	_, err := proxy.FetchSearchData(nil, version, "name = 'alice'", "name, surname")
	require.NoError(t, err)
	_, err = proxy.FetchSearchData(nil, version, "name = 'alice'", "surname, name")
	require.NoError(t, err)

	assert.Equal(t, 1, inner.searchCalls)
}

func TestSearchReaderProxySwitchBackAndForthPreservesCache(t *testing.T) {
	versionA := domainsearch.TableVersion{
		Timestamp: time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC),
		Version:   "v2",
		TableData: "chemdb.data_a",
	}
	versionB := domainsearch.TableVersion{
		Timestamp: time.Date(2026, 3, 2, 0, 0, 0, 0, time.UTC),
		Version:   "v2",
		TableData: "chemdb.data_b",
	}

	inner := &stubSearchReader{
		version: versionA,
		metadata: &domainsearch.MetadataResponse{
			Metadata:       []domainsearch.ColumnMeta{{Column: "name", Type: "text"}},
			TableTimestamp: versionA.Timestamp,
		},
	}
	proxy := cache.NewSearchReaderProxy(inner, time.Hour)

	proxy.SetActiveVersion(versionA)
	_, err := proxy.FetchMetadata(nil)
	require.NoError(t, err)

	proxy.SetActiveVersion(versionB)
	inner.version = versionB
	inner.metadata = &domainsearch.MetadataResponse{
		Metadata:       []domainsearch.ColumnMeta{{Column: "id", Type: "primary"}},
		TableTimestamp: versionB.Timestamp,
	}
	resultB, err := proxy.FetchMetadata(nil)
	require.NoError(t, err)
	assert.Equal(t, "id", resultB.Metadata[0].Column)

	proxy.SetActiveVersion(versionA)
	resultA, err := proxy.FetchMetadata(nil)
	require.NoError(t, err)
	assert.Equal(t, "name", resultA.Metadata[0].Column)
	assert.Equal(t, 2, inner.metadataCalls)
}

func TestSearchReaderProxyDifferentTableVersionUsesDifferentCacheKey(t *testing.T) {
	ts := time.Date(2026, 4, 5, 6, 7, 8, 0, time.UTC)
	versionA := domainsearch.TableVersion{Timestamp: ts, Version: "v2", TableData: "chemdb.data_a"}
	versionB := domainsearch.TableVersion{Timestamp: ts.Add(time.Hour), Version: "v2", TableData: "chemdb.data_b"}

	inner := &stubSearchReader{
		version: versionA,
		metadata: &domainsearch.MetadataResponse{
			Metadata:       []domainsearch.ColumnMeta{{Column: "name", Type: "text"}},
			TableTimestamp: ts,
		},
	}
	proxy := cache.NewSearchReaderProxy(inner, time.Hour)

	proxy.SetActiveVersion(versionA)
	_, err := proxy.FetchMetadata(nil)
	require.NoError(t, err)

	proxy.SetActiveVersion(versionB)
	inner.version = versionB
	inner.metadata = &domainsearch.MetadataResponse{
		Metadata:       []domainsearch.ColumnMeta{{Column: "id", Type: "primary"}},
		TableTimestamp: ts.Add(time.Hour),
	}
	updated, err := proxy.FetchMetadata(nil)
	require.NoError(t, err)

	assert.Equal(t, 2, inner.metadataCalls)
	assert.Equal(t, "id", updated.Metadata[0].Column)
}

func TestSearchReaderProxyTTLExpiresNegative(t *testing.T) {
	version := domainsearch.TableVersion{
		Timestamp: time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC),
		Version:   "v2",
		TableData: "chemdb.data_test",
	}
	inner := &stubSearchReader{
		version: version,
		metadata: &domainsearch.MetadataResponse{
			Metadata:       []domainsearch.ColumnMeta{{Column: "name", Type: "text"}},
			TableTimestamp: version.Timestamp,
		},
	}
	proxy := cache.NewSearchReaderProxy(inner, 20*time.Millisecond)
	proxy.SetActiveVersion(version)

	_, err := proxy.FetchMetadata(nil)
	require.NoError(t, err)

	time.Sleep(30 * time.Millisecond)

	_, err = proxy.FetchMetadata(nil)
	require.NoError(t, err)
	assert.Equal(t, 2, inner.metadataCalls)
}

func TestSearchReaderProxyRefreshActiveVersionPositive(t *testing.T) {
	version := domainsearch.TableVersion{
		Timestamp: time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC),
		Version:   "v2",
		TableData: "chemdb.data_test",
	}
	inner := &stubSearchReader{version: version}
	proxy := cache.NewSearchReaderProxy(inner, time.Hour)

	err := proxy.RefreshActiveVersion(nil)
	require.NoError(t, err)

	got, err := proxy.ActiveTableVersion(nil)
	require.NoError(t, err)
	assert.Equal(t, version, got)
}
