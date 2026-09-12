package http_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
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
		{fiber.MethodGet, "/metadata-versions"}, {fiber.MethodGet, "/metadata-versions/latest"}, {fiber.MethodPost, "/metadata-versions"},
		{fiber.MethodPost, "/metadata-versions/validate"},
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

func TestMetadataAdministrationRejectsAnonymousRequests(t *testing.T) {
	container, err := app.New(app.Options{EnvType: "TEST", AuthMaster: &routeAuth{admin: true}})
	require.NoError(t, err)
	application := presentation.NewApp(container)
	for _, target := range []struct{ method, path string }{{fiber.MethodGet, "/metadata-versions"}, {fiber.MethodGet, "/metadata-versions/latest"}, {fiber.MethodPost, "/metadata-versions"}, {fiber.MethodPost, "/metadata-versions/validate"}} {
		resp, err := application.Test(httptest.NewRequest(target.method, target.path, nil))
		require.NoError(t, err)
		require.Equal(t, fiber.StatusUnauthorized, resp.StatusCode)
		require.NoError(t, resp.Body.Close())
	}
}

func TestMetadataDraftValidationUsesImportContractWithoutDatabase(t *testing.T) {
	container, err := app.New(app.Options{EnvType: "TEST", AuthMaster: &routeAuth{admin: true}})
	require.NoError(t, err)
	application := presentation.NewApp(container)
	draft := `{"document":{"schema_version":2,"importable":true,"sheets":[{"name":"main","source_sheets":["Observations"],"columns":[{"name":"speciesid","data_type":"text","example":null}]},{"name":"classification","source_sheets":["Species"],"columns":[{"name":"speciesid","data_type":"text","primary_key":true}]}]}}`
	for _, tc := range []struct {
		name, body string
		status     int
	}{
		{"valid", draft, 200},
		{"old authoring schema", strings.Replace(draft, `"schema_version":2`, `"schema_version":1`, 1), 400},
		{"unknown field", strings.Replace(draft, `"example":null`, `"examples":null`, 1), 400},
		{"invalid type", strings.Replace(draft, `"data_type":"text"`, `"data_type":"integer"`, 1), 400},
		{"two documents", draft + draft, 400},
		{"missing document", `{}`, 400},
		{"oversized", strings.Repeat(" ", (1<<20)+1), 413},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(fiber.MethodPost, "/metadata-versions/validate", strings.NewReader(tc.body))
			req.Header.Set("Authorization", "Bearer admin")
			req.Header.Set("Content-Type", "application/json")
			resp, err := application.Test(req)
			require.NoError(t, err)
			defer resp.Body.Close()
			require.Equal(t, tc.status, resp.StatusCode)
			if tc.status == 200 {
				var body struct {
					Valid    bool `json:"valid"`
					Resolved struct {
						Sheets []struct {
							Columns []struct {
								External string `json:"external_sheet"`
							} `json:"columns"`
						} `json:"sheets"`
					} `json:"resolved_document"`
				}
				require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
				require.True(t, body.Valid)
				require.Equal(t, "classification", body.Resolved.Sheets[0].Columns[0].External)
			}
		})
	}
}

func TestNewMetadataPublicationRejectsOldSchemaBeforePersistence(t *testing.T) {
	container, err := app.New(app.Options{EnvType: "TEST", AuthMaster: &routeAuth{admin: true}})
	require.NoError(t, err)
	application := presentation.NewApp(container)
	body := `{"base_version":0,"document":{"schema_version":1,"importable":true,"sheets":[{"name":"main","source_sheets":["Observations"],"columns":[{"name":"value","data_type":"text"}]},{"name":"classification","source_sheets":["Species"],"columns":[{"name":"speciesid","data_type":"text","primary_key":true}]}]}}`
	req := httptest.NewRequest(fiber.MethodPost, "/metadata-versions", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer admin")
	req.Header.Set("Content-Type", "application/json")
	resp, err := application.Test(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, 400, resp.StatusCode)
	payload, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.Contains(t, string(payload), "schema_version 2")
}
