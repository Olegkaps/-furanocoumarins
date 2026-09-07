package http_test

import (
	infraauth "admin/internal/infrastructure/authmaster"
	"context"
	"errors"
	"io"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/require"

	"admin/internal/app"
	presentation "admin/internal/presentation/http"
)

func TestMetricsIncludeRuntimeAndRecoveredEndpointErrors(t *testing.T) {
	container, err := app.New(app.Options{EnvType: "TEST"})
	require.NoError(t, err)
	application := presentation.NewApp(container)
	application.Get("/metric-regression/:id", func(c *fiber.Ctx) error {
		if c.Params("id") == "panic" {
			panic("metrics regression")
		}
		return errors.New("returned failure")
	})
	for _, id := range []string{"panic", "private-id"} {
		response, callErr := application.Test(httptest.NewRequest(fiber.MethodGet, "/metric-regression/"+id+"?token=private-token", nil))
		require.NoError(t, callErr)
		response.Body.Close()
		require.Equal(t, fiber.StatusInternalServerError, response.StatusCode)
	}
	response, err := application.Test(httptest.NewRequest(fiber.MethodGet, "/metrics", nil))
	require.NoError(t, err)
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	require.NoError(t, err)
	text := string(body)
	require.Contains(t, text, `http_request_duration_seconds_count{method="GET",path="/metric-regression/:id",service="fuco-backend",status_code="500"} 2`)
	require.Contains(t, text, "go_goroutines ")
	require.Contains(t, text, "go_memstats_heap_alloc_bytes ")
	require.NotContains(t, text, "private-id")
	require.NotContains(t, text, "private-token")
}

func TestMetricsRegistriesAreIsolated(t *testing.T) {
	for i := 0; i < 2; i++ {
		container, err := app.New(app.Options{EnvType: "TEST"})
		require.NoError(t, err)
		application := presentation.NewApp(container)
		response, err := application.Test(httptest.NewRequest(fiber.MethodGet, "/ping", nil))
		require.NoError(t, err)
		response.Body.Close()
		response, err = application.Test(httptest.NewRequest(fiber.MethodGet, "/metrics", nil))
		require.NoError(t, err)
		body, err := io.ReadAll(response.Body)
		response.Body.Close()
		require.NoError(t, err)
		require.Contains(t, string(body), `http_requests_total{method="GET",path="/ping",service="fuco-backend",status_code="200"} 1`)
	}
}

type metricsUnavailableAuth struct{ routeAuth }

func (*metricsUnavailableAuth) Me(context.Context, string) (infraauth.User, error) {
	return infraauth.User{}, errors.New("upstream unavailable")
}

func TestMetricsRecordAuthorizationOutageAtEndpoint(t *testing.T) {
	container, err := app.New(app.Options{EnvType: "TEST", AuthMaster: &metricsUnavailableAuth{}})
	require.NoError(t, err)
	application := presentation.NewApp(container)
	response, err := application.Test(httptest.NewRequest(fiber.MethodGet, "/auth/admin/users", nil))
	require.NoError(t, err)
	response.Body.Close()
	require.Equal(t, fiber.StatusServiceUnavailable, response.StatusCode)
	response, err = application.Test(httptest.NewRequest(fiber.MethodGet, "/metrics", nil))
	require.NoError(t, err)
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	require.NoError(t, err)
	require.Contains(t, string(body), `http_requests_total{method="GET",path="/auth/admin/users",service="fuco-backend",status_code="503"} 1`)
}
