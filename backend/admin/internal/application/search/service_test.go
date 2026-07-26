package search_test

import (
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	appsearch "admin/internal/application/search"
	domainsearch "admin/internal/domain/search"
)

type stubReader struct {
	version    domainsearch.TableVersion
	metadata   *domainsearch.MetadataResponse
	searchData []map[string]any
}

func (s *stubReader) ActiveTableVersion(_ *fiber.Ctx) (domainsearch.TableVersion, error) {
	return s.version, nil
}

func (s *stubReader) FetchMetadata(_ *fiber.Ctx) (*domainsearch.MetadataResponse, error) {
	return s.metadata, nil
}

func (s *stubReader) FetchSearchData(
	_ *fiber.Ctx,
	_ domainsearch.TableVersion,
	_, _ string,
) ([]map[string]any, error) {
	return s.searchData, nil
}

type stubActiveVersions struct {
	version domainsearch.TableVersion
	calls   int
}

func (s *stubActiveVersions) SetActiveVersion(version domainsearch.TableVersion) {
	s.version = version
}

func (s *stubActiveVersions) RefreshActiveVersion(_ *fiber.Ctx) error {
	s.calls++
	return nil
}

func TestServiceGetMetadataPositive(t *testing.T) {
	ts := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	reader := &stubReader{
		metadata: &domainsearch.MetadataResponse{
			Metadata:       []domainsearch.ColumnMeta{{Column: "name", Type: "text"}},
			TableTimestamp: ts,
		},
	}
	svc := appsearch.NewService(reader, nil)

	result, err := svc.GetMetadata(nil)
	require.NoError(t, err)
	assert.Equal(t, ts, result.TableTimestamp)
}

func TestServiceSearchPositive(t *testing.T) {
	ts := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	reader := &stubReader{
		version: domainsearch.TableVersion{Timestamp: ts, Version: "v2", TableData: "chemdb.data"},
		metadata: &domainsearch.MetadataResponse{
			Metadata: []domainsearch.ColumnMeta{
				{Column: "name", Type: "text search"},
			},
			TableTimestamp: ts,
		},
		searchData: []map[string]any{{"name": "alice"}},
	}
	svc := appsearch.NewService(reader, nil)

	result, err := svc.Search(nil, "name = 'alice'")
	require.NoError(t, err)
	assert.Len(t, result.Data, 1)
}

func TestServiceSearchNegativeInvalidQuery(t *testing.T) {
	reader := &stubReader{
		metadata: &domainsearch.MetadataResponse{
			Metadata: []domainsearch.ColumnMeta{{Column: "name", Type: "text"}},
		},
	}
	svc := appsearch.NewService(reader, nil)

	_, err := svc.Search(nil, "name = 'x' OR 1=1")
	require.Error(t, err)
}

func TestServiceRefreshActiveTableVersionPositive(t *testing.T) {
	versions := &stubActiveVersions{}
	svc := appsearch.NewService(&stubReader{}, versions)
	require.NoError(t, svc.RefreshActiveTableVersion(nil))
	assert.Equal(t, 1, versions.calls)
}
