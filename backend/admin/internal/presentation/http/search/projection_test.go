package search

import (
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"admin/internal/app"
	appsearch "admin/internal/application/search"
	domainsearch "admin/internal/domain/search"
	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/require"
)

func projectionFixture() *domainsearch.SearchResponse {
	return &domainsearch.SearchResponse{
		Metadata:       []domainsearch.ColumnMeta{{Column: "names", Type: "text"}, {Column: "pubchemcid", Type: "text"}, {Column: "species", Type: "text"}},
		TableTimestamp: time.Date(2026, 9, 14, 0, 0, 0, 0, time.UTC),
		Data: []map[string]any{
			{"pubchemcid": "1", "names": "imperatorin", "species": "a"},
			{"pubchemcid": "1", "names": "imperatorin", "species": "b"},
			{"pubchemcid": "", "names": "unknown A"},
			{"pubchemcid": "", "names": "unknown B"},
			{"pubchemcid": "1", "names": "imperatorin"},
		},
	}
}

func TestProjectSearch(t *testing.T) {
	for _, tc := range []struct {
		name         string
		limit, count int
		truncated    bool
	}{
		{"omitted unique row", 2, 2, true},
		{"exact edge with trailing duplicate", 3, 3, false},
		{"under limit", 21, 3, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := projectionFixture()
			before, err := json.Marshal(source)
			require.NoError(t, err)
			got, err := projectSearch(source, []string{"pubchemcid", "names"}, tc.limit)
			require.NoError(t, err)
			require.Len(t, got.Data, tc.count)
			require.Equal(t, tc.truncated, *got.Truncated)
			require.Equal(t, source.TableTimestamp, got.TableTimestamp)
			require.Equal(t, []domainsearch.ColumnMeta{source.Metadata[1], source.Metadata[0]}, got.Metadata)
			require.Equal(t, map[string]any{"pubchemcid": "", "names": "unknown A"}, got.Data[1])
			for _, row := range got.Data {
				require.Len(t, row, 2)
			}
			got.Metadata[0].Name = "changed"
			got.Data[0]["names"] = "changed"
			after, err := json.Marshal(source)
			require.NoError(t, err)
			require.Equal(t, string(before), string(after))
		})
	}
}

func TestProjectSearchEmptyAndFailure(t *testing.T) {
	source := projectionFixture()
	source.Data = nil
	got, err := projectSearch(source, []string{"names"}, 21)
	require.NoError(t, err)
	require.NotNil(t, got.Data)
	require.Empty(t, got.Data)
	require.False(t, *got.Truncated)
	_, err = projectSearch(source, []string{"unknown"}, 21)
	require.ErrorContains(t, err, "unknown projection column")
	source.Data = []map[string]any{{"names": make(chan int)}}
	_, err = projectSearch(source, []string{"names"}, 21)
	require.ErrorContains(t, err, "encode projected search row")
}

type projectionReader struct{ source *domainsearch.SearchResponse }

func (r projectionReader) ActiveTableVersion(*fiber.Ctx) (domainsearch.TableVersion, error) {
	return domainsearch.TableVersion{}, nil
}
func (r projectionReader) FetchMetadata(*fiber.Ctx) (*domainsearch.MetadataResponse, error) {
	return &domainsearch.MetadataResponse{Metadata: r.source.Metadata, TableTimestamp: r.source.TableTimestamp}, nil
}
func (r projectionReader) FetchSearchData(_ *fiber.Ctx, _ domainsearch.TableVersion, _, _ string) ([]map[string]any, error) {
	return r.source.Data, nil
}

func TestSearchProjectionHTTP(t *testing.T) {
	source := projectionFixture()
	server := fiber.New()
	server.Get("/search", NewHandler(&app.Container{Search: appsearch.NewService(projectionReader{source}, nil)}).SearchMainApp)
	for _, tc := range []struct {
		query  string
		status int
	}{
		{"", 200},
		{"&columns=pubchemcid,names", 200},
		{"&columns=names&limit=1", 200},
		{"&columns=names&limit=100", 200},
		{"&columns=unknown", 400},
		{"&columns=names;DROP", 400},
		{"&columns=", 400},
		{"&columns=names,", 400},
		{"&columns=names,names", 400},
		{"&columns=a,b,c,d,e,f,g,h,i", 400},
		{"&limit=1", 400},
		{"&columns=names&limit=", 400},
		{"&columns=names&limit=0", 400},
		{"&columns=names&limit=-1", 400},
		{"&columns=names&limit=101", 400},
		{"&columns=names&limit=1.5", 400},
		{"&columns=names&limit=999999999999999999999", 400},
	} {
		t.Run(tc.query, func(t *testing.T) {
			res, err := server.Test(httptest.NewRequest("GET", "/search?q="+url.QueryEscape("names LIKE '%imperatorin%'")+tc.query, nil))
			require.NoError(t, err)
			defer func() { require.NoError(t, res.Body.Close()) }()
			require.Equal(t, tc.status, res.StatusCode)
			var body map[string]json.RawMessage
			require.NoError(t, json.NewDecoder(res.Body).Decode(&body))
			if tc.status != 200 {
				return
			}
			if tc.query == "" {
				require.NotContains(t, body, "truncated")
				want, err := json.Marshal(source)
				require.NoError(t, err)
				got, err := json.Marshal(body)
				require.NoError(t, err)
				require.JSONEq(t, string(want), string(got))
			} else {
				require.Contains(t, body, "truncated")
			}
		})
	}
}

func TestProjectionDefaultLimitAndMaximumColumns(t *testing.T) {
	server := fiber.New()
	server.Get("/", func(c *fiber.Ctx) error {
		columns, limit, err := projectionOptions(c)
		require.NoError(t, err)
		require.Len(t, columns, 8)
		require.Equal(t, 21, limit)
		return c.SendStatus(200)
	})
	res, err := server.Test(httptest.NewRequest("GET", "/?columns=a,b,c,d,e,f,g,h", nil))
	require.NoError(t, err)
	require.NoError(t, res.Body.Close())
}
