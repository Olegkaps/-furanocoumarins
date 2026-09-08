package authmaster

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/gofiber/fiber/v2"

	"admin/internal/app"
)

const maxAuthResponse = 4 << 20

var authCookieNames = map[string]struct{}{"refresh_token": {}, "csrf_token": {}}

type Handler struct {
	client interface {
		Request(ctx context.Context, method, path, bearer string, body io.Reader, contentType string) (*http.Response, error)
		RequestWithCredentials(ctx context.Context, method, path, bearer, cookie, csrf string, body io.Reader, contentType string) (*http.Response, error)
	}
}

func New(container *app.Container) *Handler { return &Handler{client: container.AuthMaster} }

func (h *Handler) JSON(path string, build func(*fiber.Ctx) any) fiber.Handler {
	return func(c *fiber.Ctx) error {
		body, err := json.Marshal(build(c))
		if err != nil {
			return fiber.ErrBadRequest
		}
		return h.forward(c, http.MethodPost, path, bytes.NewReader(body), "application/json")
	}
}

func (h *Handler) Forward(method, path string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		return h.forward(c, method, path, bytes.NewReader(c.Body()), c.Get("Content-Type"))
	}
}

func (h *Handler) ForwardPath(method string, path func(*fiber.Ctx) string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		return h.forward(c, method, path(c), bytes.NewReader(c.Body()), c.Get("Content-Type"))
	}
}

func (h *Handler) ForwardQuery(method, path string, allowed ...string) fiber.Handler {
	return h.forwardQuery(method, path, nil, allowed...)
}

// ForwardRoles keeps the furanocoumarins BFF contract consistently
// lower-cased even though auth-master's legacy Role model serializes exported
// Go field names. Other auth-master resources already use lower-case DTOs.
func (h *Handler) ForwardRoles(method, path string, allowed ...string) fiber.Handler {
	return h.forwardQuery(method, path, normalizeRoleResponse, allowed...)
}

func (h *Handler) forwardQuery(method, path string, transform func([]byte) ([]byte, error), allowed ...string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		requestPath := path
		query := url.Values{}
		for _, key := range allowed {
			if value := strings.TrimSpace(c.Query(key)); value != "" {
				query.Set(key, value)
			}
		}
		if encoded := query.Encode(); encoded != "" {
			requestPath += "?" + encoded
		}
		return h.forwardWithTransform(c, method, requestPath, bytes.NewReader(c.Body()), c.Get("Content-Type"), transform)
	}
}

func (h *Handler) forward(c *fiber.Ctx, method, path string, body io.Reader, contentType string) error {
	return h.forwardWithTransform(c, method, path, body, contentType, nil)
}

func (h *Handler) forwardWithTransform(c *fiber.Ctx, method, path string, body io.Reader, contentType string, transform func([]byte) ([]byte, error)) error {
	// Forward only credentials required by auth-master. Never mirror arbitrary
	// browser headers to the private upstream.
	requestBody := body
	resp, err := h.client.RequestWithCredentials(c.UserContext(), method, path, c.Get("Authorization"), requestAuthCookies(method, path, c.Get("Cookie")), c.Get("X-CSRF-Token"), requestBody, contentType)
	if err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "authentication service unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		return fiber.NewError(fiber.StatusBadGateway, "authentication service redirect rejected")
	}
	for _, cookie := range resp.Cookies() {
		if _, allowed := authCookieNames[cookie.Name]; !allowed {
			continue
		}
		// authd is on a private host, so its cookie scope must be rewritten to
		// the public same-origin BFF root; upstream Domain is never propagated.
		c.Cookie(&fiber.Cookie{Name: cookie.Name, Value: cookie.Value, Path: "/", MaxAge: cookie.MaxAge, Expires: cookie.Expires, HTTPOnly: cookie.HttpOnly, Secure: cookie.Secure, SameSite: sameSite(cookie.SameSite)})
	}
	if value := resp.Header.Get("Content-Type"); value != "" {
		c.Set("Content-Type", value)
	}
	if value := resp.Header.Get("X-Token-Stale"); value != "" {
		c.Set("X-Token-Stale", value)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxAuthResponse+1))
	if err != nil {
		return fiber.ErrBadGateway
	}
	if len(data) > maxAuthResponse {
		return fiber.NewError(fiber.StatusBadGateway, "authentication response too large")
	}
	if transform != nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
		data, err = transform(data)
		if err != nil {
			return fiber.NewError(fiber.StatusBadGateway, "invalid authentication response")
		}
	}
	return c.Status(resp.StatusCode).Send(data)
}

func requestAuthCookies(method, path, raw string) string {
	if raw == "" {
		return ""
	}
	wanted := map[string]struct{}{}
	cleanPath := path
	if index := strings.IndexByte(cleanPath, '?'); index >= 0 {
		cleanPath = cleanPath[:index]
	}
	if cleanPath == "/v1/auth/refresh" || cleanPath == "/v1/auth/logout" {
		wanted["refresh_token"] = struct{}{}
		wanted["csrf_token"] = struct{}{}
	} else if needsAuthCSRFCookie(method, cleanPath) {
		wanted["csrf_token"] = struct{}{}
	}
	if len(wanted) == 0 {
		return ""
	}
	request := &http.Request{Header: http.Header{"Cookie": []string{raw}}}
	parts := make([]string, 0, len(wanted))
	seen := map[string]struct{}{}
	for _, cookie := range request.Cookies() {
		if _, ok := wanted[cookie.Name]; !ok {
			continue
		}
		if _, duplicate := seen[cookie.Name]; duplicate {
			continue
		}
		seen[cookie.Name] = struct{}{}
		parts = append(parts, cookie.Name+"="+cookie.Value)
	}
	return strings.Join(parts, "; ")
}

func needsAuthCSRFCookie(method, path string) bool {
	if method != http.MethodPost && method != http.MethodDelete && method != http.MethodPatch {
		return false
	}
	if path == "/v1/admin/registration-invites" || path == "/v1/admin/signing-keys/rotate" {
		return true
	}
	if strings.HasPrefix(path, "/v1/admin/users/") && strings.HasSuffix(path, "/ban") {
		return true
	}
	return strings.HasPrefix(path, "/v1/roles/") && strings.Contains(path, "/members")
}

func normalizeRoleResponse(data []byte) ([]byte, error) {
	var payload struct {
		Roles      []map[string]any `json:"roles"`
		PageSize   int              `json:"page_size,omitempty"`
		Total      any              `json:"total,omitempty"`
		NextCursor string           `json:"next_cursor,omitempty"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, err
	}
	for _, role := range payload.Roles {
		for upper, lower := range map[string]string{
			"ID": "id", "Name": "name", "Description": "description",
			"ParentIDs": "parent_ids", "ParentID": "parent_id", "Tags": "tags", "CreatedAt": "created_at",
		} {
			if value, ok := role[upper]; ok {
				role[lower] = value
				delete(role, upper)
			}
		}
	}
	return json.Marshal(payload)
}

func sameSite(value http.SameSite) string {
	switch value {
	case http.SameSiteStrictMode:
		return "Strict"
	case http.SameSiteNoneMode:
		return "None"
	default:
		return "Lax"
	}
}

func LoginBody(c *fiber.Ctx) any {
	return map[string]string{"login": c.FormValue("uname_or_email"), "password": c.FormValue("password")}
}
func MagicStartBody(c *fiber.Ctx) any {
	return map[string]string{"login": c.FormValue("uname_or_email")}
}
func MagicVerifyBody(c *fiber.Ctx) any {
	return map[string]string{"token": c.FormValue("word"), "device_id": deviceID(c), "device_label": "furanocoumarins browser"}
}
func OTPVerifyBody(c *fiber.Ctx) any {
	return map[string]string{"challenge": c.FormValue("challenge"), "code": c.FormValue("code"), "device_id": deviceID(c), "device_label": "furanocoumarins browser"}
}
func deviceID(c *fiber.Ctx) string {
	if value := strings.TrimSpace(c.FormValue("device_id")); value != "" {
		return value
	}
	if value := strings.TrimSpace(c.Get("X-Device-ID")); value != "" {
		return value
	}
	return "furanocoumarins-web"
}
