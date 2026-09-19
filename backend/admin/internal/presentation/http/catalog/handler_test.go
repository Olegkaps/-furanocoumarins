package catalog

import (
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/require"

	"admin/internal/app"
)

func TestBoundedPositiveInt(t *testing.T) {
	for _, raw := range []string{"", "0", "101", "not-a-number"} {
		_, err := boundedPositiveInt(raw, 1, 100, "page_size")
		require.Error(t, err, raw)
	}
	value, err := boundedPositiveInt("24", 1, 100, "page_size")
	require.NoError(t, err)
	require.Equal(t, 24, value)
}

func TestListRejectsUnknownKindAndInvalidPagination(t *testing.T) {
	container, err := app.New(app.Options{EnvType: "TEST"})
	require.NoError(t, err)
	application := fiber.New()
	handler := NewHandler(container)
	application.Get("/catalog/:kind", handler.List)
	for _, path := range []string{"/catalog/unknown", "/catalog/species?page_size=101", "/catalog/chemicals?cursor=one&before=two", "/catalog/chemicals?cursor=%21"} {
		response, requestErr := application.Test(httptest.NewRequest(fiber.MethodGet, path, nil))
		require.NoError(t, requestErr)
		require.Equal(t, fiber.StatusBadRequest, response.StatusCode, path)
		require.NoError(t, response.Body.Close())
	}
}

func TestCountRejectsUnknownKindAndInvalidPageSize(t *testing.T) {
	container, err := app.New(app.Options{EnvType: "TEST"})
	require.NoError(t, err)
	application := fiber.New()
	handler := NewHandler(container)
	application.Get("/catalog/:kind/count", handler.Count)
	for _, path := range []string{"/catalog/unknown/count", "/catalog/species/count?page_size=101"} {
		response, requestErr := application.Test(httptest.NewRequest(fiber.MethodGet, path, nil))
		require.NoError(t, requestErr)
		require.Equal(t, fiber.StatusBadRequest, response.StatusCode, path)
		require.NoError(t, response.Body.Close())
	}
}

func TestListReportsLegacySourceCatalogUnavailable(t *testing.T) {
	container, err := app.New(app.Options{EnvType: "TEST"})
	require.NoError(t, err)
	application := fiber.New()
	application.Get("/catalog/:kind", NewHandler(container).List)
	response, err := application.Test(httptest.NewRequest(fiber.MethodGet, "/catalog/chemicals", nil))
	require.NoError(t, err)
	defer response.Body.Close()
	require.Equal(t, fiber.StatusConflict, response.StatusCode)
}
