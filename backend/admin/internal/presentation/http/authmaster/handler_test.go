package authmaster

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gofiber/fiber/v2"
)

type handlerClient struct{ response *http.Response }

func (c *handlerClient) Request(context.Context, string, string, string, io.Reader, string) (*http.Response, error) {
	return c.response, nil
}
func (c *handlerClient) RequestWithCredentials(context.Context, string, string, string, string, string, io.Reader, string) (*http.Response, error) {
	return c.response, nil
}

type recordingHandlerClient struct {
	mu      sync.Mutex
	paths   []string
	cookies []string
}

func (c *recordingHandlerClient) Request(context.Context, string, string, string, io.Reader, string) (*http.Response, error) {
	return nil, nil
}

func (c *recordingHandlerClient) RequestWithCredentials(_ context.Context, _, path, _, cookie, _ string, _ io.Reader, _ string) (*http.Response, error) {
	c.mu.Lock()
	c.paths = append(c.paths, path)
	c.cookies = append(c.cookies, cookie)
	c.mu.Unlock()
	return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{}`))}, nil
}

func TestForwardWhitelistsAuthCookiesByRouteAndResponse(t *testing.T) {
	client := &recordingHandlerClient{}
	handler := &Handler{client: client}
	app := fiber.New()
	app.Get("/me", handler.Forward(http.MethodGet, "/v1/me"))
	app.Post("/login", handler.Forward(http.MethodPost, "/v1/auth/login"))
	app.Post("/refresh", handler.Forward(http.MethodPost, "/v1/auth/refresh"))
	app.Post("/ban", handler.Forward(http.MethodPost, "/v1/admin/users/user-id/ban"))

	request := httptest.NewRequest(http.MethodGet, "/me", nil)
	request.Header.Set("Cookie", "sentinel=private; refresh_token=refresh; csrf_token=csrf")
	resp, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	request = httptest.NewRequest(http.MethodPost, "/login", nil)
	request.Header.Set("Cookie", "sentinel=private; refresh_token=refresh; csrf_token=csrf")
	resp, err = app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	request = httptest.NewRequest(http.MethodPost, "/refresh", nil)
	request.Header.Set("Cookie", "sentinel=private; refresh_token=refresh; csrf_token=csrf")
	resp, err = app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	request = httptest.NewRequest(http.MethodPost, "/ban", nil)
	request.Header.Set("Cookie", "sentinel=private; refresh_token=refresh; csrf_token=csrf")
	resp, err = app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()

	client.mu.Lock()
	if got := client.cookies; len(got) != 4 || got[0] != "" || got[1] != "" || got[2] != "refresh_token=refresh; csrf_token=csrf" || got[3] != "csrf_token=csrf" {
		client.mu.Unlock()
		t.Fatalf("forwarded cookies = %#v", got)
	}
	client.mu.Unlock()

	upstream := &http.Response{
		StatusCode: http.StatusOK,
		Header: http.Header{"Set-Cookie": []string{
			"refresh_token=ok; Path=/; HttpOnly",
			"csrf_token=ok; Path=/",
			"sentinel=leaked; Path=/",
		}},
		Body: io.NopCloser(strings.NewReader(`{}`)),
	}
	responseHandler := &Handler{client: &handlerClient{response: upstream}}
	responseApp := fiber.New()
	responseApp.Post("/", responseHandler.Forward(http.MethodPost, "/v1/auth/refresh"))
	resp, err = responseApp.Test(httptest.NewRequest(http.MethodPost, "/", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	setCookies := strings.Join(resp.Header.Values("Set-Cookie"), "\n")
	if !strings.Contains(setCookies, "refresh_token=ok") || !strings.Contains(setCookies, "csrf_token=ok") || strings.Contains(setCookies, "sentinel") {
		t.Fatalf("response cookies = %q", setCookies)
	}
}

func TestNormalizeRoleResponseProvidesStableLowerCaseContract(t *testing.T) {
	input := []byte(`{"roles":[{"ID":"role-id","Name":"admin","Description":"Admin","ParentIDs":[],"ParentID":null,"Tags":[],"CreatedAt":"2026-01-01T00:00:00Z"}],"page_size":50,"total":1,"next_cursor":""}`)
	output, err := normalizeRoleResponse(input)
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		Roles []map[string]any `json:"roles"`
	}
	if err := json.Unmarshal(output, &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Roles) != 1 || payload.Roles[0]["id"] != "role-id" || payload.Roles[0]["name"] != "admin" {
		t.Fatalf("unexpected normalized roles: %#v", payload.Roles)
	}
	if _, leaked := payload.Roles[0]["ID"]; leaked {
		t.Fatal("upstream exported Go field leaked into the BFF contract")
	}
}

func TestNormalizeRoleResponseRejectsInvalidUpstreamJSON(t *testing.T) {
	if _, err := normalizeRoleResponse([]byte("not-json")); err == nil {
		t.Fatal("expected malformed upstream response to fail closed")
	}
}

func TestDeviceIDPreservesBrowserFormValue(t *testing.T) {
	app := fiber.New()
	app.Post("/", func(c *fiber.Ctx) error { return c.SendString(deviceID(c)) })
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("device_id=browser-one"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(resp.Body)
	if string(data) != "browser-one" {
		t.Fatalf("device id = %q", data)
	}
}

func TestForwardPreservesStaleTokenSignal(t *testing.T) {
	upstream := &http.Response{StatusCode: http.StatusUnauthorized, Header: http.Header{"X-Token-Stale": []string{"1"}, "Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"error":"stale"}`))}
	handler := &Handler{client: &handlerClient{response: upstream}}
	app := fiber.New()
	app.Get("/", handler.Forward(http.MethodGet, "/v1/me"))
	resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/", nil))
	if err != nil {
		t.Fatal(err)
	}
	if resp.Header.Get("X-Token-Stale") != "1" {
		t.Fatalf("stale signal = %q", resp.Header.Get("X-Token-Stale"))
	}
}

func TestForwardQueryDoesNotAccumulateStateAcrossRepeatedOrConcurrentRequests(t *testing.T) {
	client := &recordingHandlerClient{}
	handler := &Handler{client: client}
	app := fiber.New()
	app.Get("/", handler.ForwardQuery(http.MethodGet, "/v1/auth/registration-invite", "token"))

	for _, token := range []string{"first-token", "second-token"} {
		resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/?token="+token, nil))
		if err != nil {
			t.Fatalf("sequential request failed: %v", err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("sequential status = %d", resp.StatusCode)
		}
	}

	client.mu.Lock()
	sequentialPaths := append([]string(nil), client.paths...)
	client.paths = nil
	client.mu.Unlock()
	if len(sequentialPaths) != 2 ||
		sequentialPaths[0] != "/v1/auth/registration-invite?token=first-token" ||
		sequentialPaths[1] != "/v1/auth/registration-invite?token=second-token" {
		t.Fatalf("sequential upstream paths = %#v", sequentialPaths)
	}

	const requests = 32
	var wg sync.WaitGroup
	for range requests {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/?token=invite-token", nil))
			if err != nil {
				t.Errorf("request failed: %v", err)
				return
			}
			_ = resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				t.Errorf("status = %d", resp.StatusCode)
			}
		}()
	}
	wg.Wait()

	client.mu.Lock()
	defer client.mu.Unlock()
	if len(client.paths) != requests {
		t.Fatalf("upstream requests = %d, want %d", len(client.paths), requests)
	}
	for _, path := range client.paths {
		if path != "/v1/auth/registration-invite?token=invite-token" {
			t.Fatalf("mutated upstream path %q", path)
		}
	}
}

func TestForwardQueryWhitelistsAuthMasterKeysetAndSearchParameters(t *testing.T) {
	client := &recordingHandlerClient{}
	handler := &Handler{client: client}
	app := fiber.New()
	app.Get("/", handler.ForwardQuery(http.MethodGet, "/v1/admin/users", "q", "cursor", "page_size"))

	resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/?q=second&cursor=opaque&page_size=25&query=ignored", nil))
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()

	client.mu.Lock()
	defer client.mu.Unlock()
	if len(client.paths) != 1 || client.paths[0] != "/v1/admin/users?cursor=opaque&page_size=25&q=second" {
		t.Fatalf("upstream paths = %#v", client.paths)
	}
}
