package authmaster

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestClientRejectsRedirectAndForwardsOnlyExplicitCredentials(t *testing.T) {
	var got http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Clone()
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, "https://example.invalid/steal", http.StatusFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	client := New(server.URL)
	resp, err := client.RequestWithCredentials(context.Background(), http.MethodPost, "/ok", "Bearer token", "refresh_token=x", "csrf", nil, "application/json")
	require.NoError(t, err)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, "Bearer token", got.Get("Authorization"))
	require.Equal(t, "refresh_token=x", got.Get("Cookie"))
	require.Equal(t, "csrf", got.Get("X-CSRF-Token"))
	resp, err = client.Request(context.Background(), http.MethodGet, "/redirect", "Bearer secret", nil, "")
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusFound, resp.StatusCode)
}

func TestClientMeAndHasRoleRejectMalformedOrAmbiguousJSON(t *testing.T) {
	tests := []struct {
		name string
		path string
		body string
		call func(*Client) error
	}{
		{name: "empty me", path: "/v1/me", body: `{}`, call: func(c *Client) error { _, err := c.Me(context.Background(), "Bearer x"); return err }},
		{name: "partial superuser", path: "/v1/me", body: `{"superuser":true}`, call: func(c *Client) error { _, err := c.Me(context.Background(), "Bearer x"); return err }},
		{name: "wrong id", path: "/v1/me", body: `{"id":"no","login":"x","email":"x@example.test","kind":"human","superuser":false}`, call: func(c *Client) error { _, err := c.Me(context.Background(), "Bearer x"); return err }},
		{name: "human missing email", path: "/v1/me", body: `{"id":"00000000-0000-0000-0000-000000000001","login":"x","kind":"human","superuser":false}`, call: func(c *Client) error { _, err := c.Me(context.Background(), "Bearer x"); return err }},
		{name: "trailing json", path: "/v1/me", body: `{"id":"00000000-0000-0000-0000-000000000001","login":"x","email":"x@example.test","kind":"human","superuser":false}{}`, call: func(c *Client) error { _, err := c.Me(context.Background(), "Bearer x"); return err }},
		{name: "trailing garbage", path: "/v1/me", body: `{"id":"00000000-0000-0000-0000-000000000001","login":"x","email":"x@example.test","kind":"human","superuser":false}garbage`, call: func(c *Client) error { _, err := c.Me(context.Background(), "Bearer x"); return err }},
		{name: "missing role", path: "/v1/me/has-role", body: `{}`, call: func(c *Client) error { _, err := c.HasRole(context.Background(), "Bearer x", "admin"); return err }},
		{name: "wrong role type", path: "/v1/me/has-role", body: `{"has_role":"yes"}`, call: func(c *Client) error { _, err := c.HasRole(context.Background(), "Bearer x", "admin"); return err }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != test.path {
					t.Fatalf("path=%s want=%s", r.URL.Path, test.path)
				}
				w.Header().Set("Content-Type", "application/json")
				if _, err := fmt.Fprint(w, test.body); err != nil {
					t.Errorf("write auth-master fixture response: %v", err)
				}
			}))
			defer server.Close()
			require.Error(t, test.call(New(server.URL)))
		})
	}
}

func TestClientMeAndHasRoleAcceptCompleteSingleDocuments(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/me" {
			if _, err := fmt.Fprint(w, `{"id":"00000000-0000-0000-0000-000000000001","login":"x","email":"x@example.test","kind":"human","superuser":false}`); err != nil {
				t.Errorf("write auth-master user fixture response: %v", err)
			}
			return
		}
		if _, err := fmt.Fprint(w, `{"has_role":false}`); err != nil {
			t.Errorf("write auth-master role fixture response: %v", err)
		}
	}))
	defer server.Close()
	client := New(server.URL)
	user, err := client.Me(context.Background(), "Bearer x")
	require.NoError(t, err)
	require.Equal(t, "human", user.Kind)
	has, err := client.HasRole(context.Background(), "Bearer x", "admin")
	require.NoError(t, err)
	require.False(t, has)
}
