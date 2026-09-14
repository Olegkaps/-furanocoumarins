package http_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"

	"admin/internal/app"
	infraauth "admin/internal/infrastructure/authmaster"
	presentation "admin/internal/presentation/http"
	reader "admin/internal/publicationreader"
	"admin/settings"
	"github.com/stretchr/testify/require"
)

type publicationAuth struct {
	routeAuth
	meErr   error
	roleErr error
}

func (a *publicationAuth) Me(context.Context, string) (infraauth.User, error) {
	return infraauth.User{Email: ptr("admin@example.test")}, a.meErr
}
func (a *publicationAuth) HasRole(context.Context, string, string) (bool, error) {
	return a.admin, a.roleErr
}

func TestPublicationReaderRevalidatesRolesAndFailsClosed(t *testing.T) {
	auth := &publicationAuth{routeAuth: routeAuth{admin: true}}
	container, err := app.New(app.Options{EnvType: "TEST", AuthMaster: auth})
	require.NoError(t, err)
	application := presentation.NewApp(container)
	for _, route := range []struct {
		method, path  string
		allowedStatus int
	}{{"GET", "status", 200}, {"POST", "document", 400}, {"POST", "analyze", 422}} {
		for _, scenario := range []struct {
			admin          bool
			meErr, roleErr error
			status         int
		}{
			{true, nil, nil, route.allowedStatus},
			{false, nil, nil, 403},
			{true, errors.New("auth unavailable"), nil, 503},
			{true, nil, errors.New("roles unavailable"), 503},
			{true, &infraauth.StatusError{Status: 401}, nil, 401},
		} {
			auth.admin, auth.meErr, auth.roleErr = scenario.admin, scenario.meErr, scenario.roleErr
			req := httptest.NewRequest(route.method, "/admin/publication-reader/"+route.path, strings.NewReader(`{}`))
			req.Header.Set("Authorization", "Bearer same-token")
			req.Header.Set("Content-Type", "application/json")
			resp, err := application.Test(req)
			require.NoError(t, err)
			require.Equal(t, scenario.status, resp.StatusCode, route.path)
			require.NoError(t, resp.Body.Close())
		}
	}
}

func TestPublicationReaderRequiresAdminOnEveryRoute(t *testing.T) {
	for _, admin := range []bool{false, true} {
		container, err := app.New(app.Options{EnvType: "TEST", AuthMaster: &routeAuth{admin: admin}})
		require.NoError(t, err)
		application := presentation.NewApp(container)
		for _, route := range []struct{ method, path string }{{"GET", "status"}, {"POST", "document"}, {"POST", "analyze"}} {
			for _, bearer := range []string{"", "Bearer actor"} {
				if admin && bearer != "" {
					continue
				}
				req := httptest.NewRequest(route.method, "/admin/publication-reader/"+route.path, strings.NewReader(`{}`))
				req.Header.Set("Authorization", bearer)
				req.Header.Set("Content-Type", "application/json")
				resp, err := application.Test(req)
				require.NoError(t, err)
				want := 403
				if bearer == "" {
					want = 401
				}
				require.Equal(t, want, resp.StatusCode, route.path)
				require.NoError(t, resp.Body.Close())
			}
		}
	}
}

func TestPublicationReaderAdminContract(t *testing.T) {
	previous := settings.C
	t.Cleanup(func() { settings.C = previous })
	settings.C.AliceAPIEnabled = false
	settings.C.AliceAPIKey = "server-secret"
	settings.C.AliceModelURI = "gpt://folder/model"
	container, err := app.New(app.Options{EnvType: "TEST", AuthMaster: &routeAuth{admin: true}})
	require.NoError(t, err)
	application := presentation.NewApp(container)
	for _, tc := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", "status", "", 200},
		{"POST", "analyze", `{"document":{"title":"Study","pages":[{"number":1,"text":"Bergapten detected"}]}}`, 503},
		{"POST", "analyze", `{"document":{"pages":[{"number":0,"text":"text"}]}}`, 400},
		{"POST", "analyze", `{"document":{"pages":[]}}`, 422},
		{"POST", "analyze", strings.Repeat(" ", reader.MaxJSONBytes+1), 413},
		{"POST", "document", `{"url":"http://127.0.0.1"}`, 400},
		{"POST", "document", `{"url":"file:///etc/passwd"}`, 400},
		{"POST", "document", `{"url":"https://user:secret@example.com"}`, 400},
		{"POST", "document", `{"url":"https://example.com","extra":true}`, 400},
		{"POST", "document", `{} {}`, 400},
		{"POST", "document", `null`, 400},
	} {
		req := httptest.NewRequest(tc.method, "/admin/publication-reader/"+tc.path, strings.NewReader(tc.body))
		req.Header.Set("Authorization", "Bearer admin")
		req.Header.Set("Content-Type", "application/json")
		resp, err := application.Test(req)
		require.NoError(t, err)
		data, err := io.ReadAll(resp.Body)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())
		require.Equal(t, tc.status, resp.StatusCode, string(data))
		require.NotContains(t, string(data), "server-secret")
		if tc.path == "status" {
			var status struct {
				Configured bool   `json:"configured"`
				Provider   string `json:"provider"`
			}
			require.NoError(t, json.Unmarshal(data, &status))
			require.False(t, status.Configured)
			require.Equal(t, "yandex", status.Provider)
		}
	}
}

func TestPublicationReaderUploads(t *testing.T) {
	container, err := app.New(app.Options{EnvType: "TEST", AuthMaster: &routeAuth{admin: true}})
	require.NoError(t, err)
	application := presentation.NewApp(container)
	for _, tc := range []struct {
		name, text    string
		count, status int
	}{
		{"study.txt", "Bergapten isolated", 1, 200},
		{"study.html", "<html><title>Paper</title><p>Bergapten isolated</p></html>", 1, 200},
		{"fulltext.html", "<p>" + strings.Repeat("a", 100000) + "</p>", 1, 200},
		{"study.png", "binary", 1, 415},
		{"empty.txt", "", 1, 422},
		{"study.txt", "text", 2, 400},
		{"study.txt", strings.Repeat("a", reader.MaxSourceBytes+1), 1, 413},
	} {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		for i := 0; i < tc.count; i++ {
			part, err := writer.CreateFormFile("file", tc.name)
			require.NoError(t, err)
			_, err = io.WriteString(part, tc.text)
			require.NoError(t, err)
		}
		require.NoError(t, writer.Close())
		req := httptest.NewRequest("POST", "/admin/publication-reader/document", &body)
		req.Header.Set("Authorization", "Bearer admin")
		req.Header.Set("Content-Type", writer.FormDataContentType())
		resp, err := application.Test(req)
		require.NoError(t, err)
		data, err := io.ReadAll(resp.Body)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())
		require.Equal(t, tc.status, resp.StatusCode, string(data))
		if tc.status == 200 {
			var d reader.Document
			require.NoError(t, json.Unmarshal(data, &d))
			require.Len(t, d.Pages, 1)
			require.NotEmpty(t, d.Warnings)
		}
	}
}
