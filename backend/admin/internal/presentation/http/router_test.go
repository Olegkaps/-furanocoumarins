package http_test

import (
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/require"

	"admin/internal/app"
	presentation "admin/internal/presentation/http"
)

func TestNewAppPing(t *testing.T) {
	container, err := app.New(app.Options{EnvType: "TEST"})
	require.NoError(t, err)

	fiberApp := presentation.NewApp(container)
	req := httptest.NewRequest(fiber.MethodGet, "/ping", nil)
	resp, err := fiberApp.Test(req)
	require.NoError(t, err)
	require.Equal(t, fiber.StatusOK, resp.StatusCode)
}
