// Package authmaster is the fail-closed HTTP adapter used by furanocoumarins.
// authd remains private; browser requests use same-origin compatibility routes.
package authmaster

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
)

type User struct {
	ID        string  `json:"id"`
	Login     string  `json:"login"`
	Email     *string `json:"email"`
	Kind      string  `json:"kind"`
	Superuser bool    `json:"superuser"`
}

type Client struct {
	base string
	http *http.Client
}

type StatusError struct {
	Status     int
	TokenStale bool
}

func (e *StatusError) Error() string { return fmt.Sprintf("auth-master returned %d", e.Status) }

func statusError(resp *http.Response) *StatusError {
	return &StatusError{Status: resp.StatusCode, TokenStale: resp.Header.Get("X-Token-Stale") == "1"}
}

func New(base string) *Client {
	return &Client{base: strings.TrimRight(base, "/"), http: &http.Client{
		Timeout:       5 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

func (c *Client) Request(ctx context.Context, method, path, bearer string, body io.Reader, contentType string) (*http.Response, error) {
	return c.RequestWithCredentials(ctx, method, path, bearer, "", "", body, contentType)
}

func (c *Client) RequestWithCredentials(ctx context.Context, method, path, bearer, cookie, csrf string, body io.Reader, contentType string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return nil, err
	}
	if bearer != "" {
		req.Header.Set("Authorization", bearer)
	}
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	if csrf != "" {
		req.Header.Set("X-CSRF-Token", csrf)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("auth-master unavailable: %w", err)
	}
	return resp, nil
}

func (c *Client) Me(ctx context.Context, bearer string) (User, error) {
	resp, err := c.Request(ctx, http.MethodGet, "/v1/me", bearer, nil, "")
	if err != nil {
		return User{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return User{}, statusError(resp)
	}
	var wire struct {
		ID        *string `json:"id"`
		Login     *string `json:"login"`
		Email     *string `json:"email"`
		Kind      *string `json:"kind"`
		Superuser *bool   `json:"superuser"`
	}
	if err := decodeSingleJSON(resp.Body, &wire); err != nil {
		return User{}, err
	}
	if wire.ID == nil || uuid.Validate(*wire.ID) != nil || wire.Login == nil || strings.TrimSpace(*wire.Login) == "" ||
		wire.Kind == nil || (*wire.Kind != "human" && *wire.Kind != "service") || wire.Superuser == nil {
		return User{}, errors.New("invalid auth-master user response")
	}
	if *wire.Kind == "human" && (wire.Email == nil || strings.TrimSpace(*wire.Email) == "") {
		return User{}, errors.New("invalid auth-master human response")
	}
	return User{ID: *wire.ID, Login: *wire.Login, Email: wire.Email, Kind: *wire.Kind, Superuser: *wire.Superuser}, nil
}

func (c *Client) HasRole(ctx context.Context, bearer, role string) (bool, error) {
	q := url.Values{"role_name": {role}}
	resp, err := c.Request(ctx, http.MethodGet, "/v1/me/has-role?"+q.Encode(), bearer, nil, "")
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, statusError(resp)
	}
	var result struct {
		HasRole *bool `json:"has_role"`
	}
	if err := decodeSingleJSON(resp.Body, &result); err != nil {
		return false, err
	}
	if result.HasRole == nil {
		return false, errors.New("invalid auth-master role response")
	}
	return *result.HasRole, nil
}

const maxJSONResponse = 1 << 20

func decodeSingleJSON(body io.Reader, target any) error {
	limited := &io.LimitedReader{R: body, N: maxJSONResponse + 1}
	decoder := json.NewDecoder(limited)
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("decode auth-master response: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return errors.New("auth-master response contains multiple JSON documents")
		}
		return fmt.Errorf("auth-master response has trailing data: %w", err)
	}
	if limited.N <= 0 {
		return errors.New("auth-master response exceeds size limit")
	}
	return nil
}

func JSONBody(value any) (io.Reader, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}
