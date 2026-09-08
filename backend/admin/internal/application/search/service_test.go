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
	version     domainsearch.TableVersion
	metadata    *domainsearch.MetadataResponse
	searchData  []map[string]any
	metadataErr error
	versionErr  error
	searchErr   error
}

func (s *stubReader) ActiveTableVersion(_ *fiber.Ctx) (domainsearch.TableVersion, error) {
	return s.version, s.versionErr
}

func (s *stubReader) FetchMetadata(_ *fiber.Ctx) (*domainsearch.MetadataResponse, error) {
	return s.metadata, s.metadataErr
}

func (s *stubReader) FetchSearchData(
	_ *fiber.Ctx,
	_ domainsearch.TableVersion,
	_, _ string,
) ([]map[string]any, error) {
	return s.searchData, s.searchErr
}

type stubActiveVersions struct {
	version domainsearch.TableVersion
	calls   int
	err     error
}

func (s *stubActiveVersions) SetActiveVersion(version domainsearch.TableVersion) {
	s.version = version
}

func (s *stubActiveVersions) RefreshActiveVersion(_ *fiber.Ctx) error {
	s.calls++
	return s.err
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

func TestServiceRefreshActiveTableVersionWithoutRegistry(t *testing.T) {
	svc := appsearch.NewService(&stubReader{}, nil)
	require.NoError(t, svc.RefreshActiveTableVersion(nil))
}

func TestServiceRefreshActiveTableVersionPropagatesError(t *testing.T) {
	versions := &stubActiveVersions{err: assert.AnError}
	svc := appsearch.NewService(&stubReader{}, versions)
	require.ErrorIs(t, svc.RefreshActiveTableVersion(nil), assert.AnError)
	assert.Equal(t, 1, versions.calls)
}

func TestServiceSearchPropagatesReaderErrors(t *testing.T) {
	validMetadata := &domainsearch.MetadataResponse{
		Metadata: []domainsearch.ColumnMeta{{Column: "name", Type: "text search"}},
	}
	for _, test := range []struct {
		name   string
		reader *stubReader
	}{
		{name: "metadata", reader: &stubReader{metadataErr: assert.AnError}},
		{name: "active version", reader: &stubReader{metadata: validMetadata, versionErr: assert.AnError}},
		{name: "search data", reader: &stubReader{metadata: validMetadata, searchErr: assert.AnError}},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := appsearch.NewService(test.reader, nil).Search(nil, "name = 'alice'")
			require.ErrorIs(t, err, assert.AnError)
		})
	}
}

func TestServiceSearchRejectsMetadataWithoutVisibleColumns(t *testing.T) {
	reader := &stubReader{metadata: &domainsearch.MetadataResponse{
		Metadata: []domainsearch.ColumnMeta{{Column: "secret", Type: "invisible text"}},
	}}
	_, err := appsearch.NewService(reader, nil).Search(nil, "secret = 'alice'")
	require.EqualError(t, err, "no visible columns found in table metadata")
}
