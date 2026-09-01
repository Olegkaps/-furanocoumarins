package http_test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/require"

	"admin/internal/app"
	infraauth "admin/internal/infrastructure/authmaster"
	presentation "admin/internal/presentation/http"
)

type routeAuth struct{ admin bool }

func (f *routeAuth) Request(context.Context, string, string, string, io.Reader, string) (*http.Response, error) {
	return nil, errors.New("unused")
}
func (f *routeAuth) RequestWithCredentials(context.Context, string, string, string, string, string, io.Reader, string) (*http.Response, error) {
	return nil, errors.New("unused")
}
func (f *routeAuth) Me(context.Context, string) (infraauth.User, error) {
	return infraauth.User{Login: "actor", Email: ptr("actor@example.test")}, nil
}
func (f *routeAuth) HasRole(context.Context, string, string) (bool, error) { return f.admin, nil }
func ptr(value string) *string                                             { return &value }

func TestNewAppPing(t *testing.T) {
	container, err := app.New(app.Options{EnvType: "TEST"})
	require.NoError(t, err)

	fiberApp := presentation.NewApp(container)
	req := httptest.NewRequest(fiber.MethodGet, "/ping", nil)
	resp, err := fiberApp.Test(req)
	require.NoError(t, err)
	require.Equal(t, fiber.StatusOK, resp.StatusCode)
}

func TestEveryDomainMutationDeniesAuthenticatedNonAdmin(t *testing.T) {
	container, err := app.New(app.Options{EnvType: "TEST", AuthMaster: &routeAuth{admin: false}})
	require.NoError(t, err)
	application := presentation.NewApp(container)
	for _, target := range []struct{ method, path string }{
		{fiber.MethodPost, "/create-table"}, {fiber.MethodPost, "/make-table-active/not-a-time"},
		{fiber.MethodGet, "/table-imports/not-an-import"},
		{fiber.MethodDelete, "/table/not-a-time"}, {fiber.MethodDelete, "/tables"},
		{fiber.MethodPut, "/bibtex"}, {fiber.MethodPut, "/pages/about"},
	} {
		req := httptest.NewRequest(target.method, target.path, nil)
		req.Header.Set("Authorization", "Bearer non-admin")
		resp, requestErr := application.Test(req)
		require.NoError(t, requestErr, target.path)
		require.Equal(t, fiber.StatusForbidden, resp.StatusCode, target.path)
	}
}
