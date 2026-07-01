package auth_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"

	"admin/internal/app"
	domainauth "admin/internal/domain/auth"
	domainuser "admin/internal/domain/user"
	inframailmemory "admin/internal/infrastructure/mail/memory"
	inframemory "admin/internal/infrastructure/persistence/memory"
	"admin/internal/infrastructure/security"
	authhandler "admin/internal/presentation/http/auth"
)

func testContainer(t *testing.T, users ...domainuser.User) *app.Container {
	t.Helper()
	container, err := app.New(app.Options{
		EnvType:    "TEST",
		SecretKey:  []byte("secret"),
		DomainPref: "https://example.com",
		Users:      inframemory.NewUserRepository(users...),
	})
	require.NoError(t, err)
	return container
}

func postForm(t *testing.T, app *fiber.App, path string, form url.Values) *http.Response {
	t.Helper()
	req := httptest.NewRequest(fiber.MethodPost, path, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := app.Test(req, 5000)
	require.NoError(t, err)
	return resp
}

func TestHandlerLoginWrongPasswordReturns401(t *testing.T) {
	hasher := security.PasswordHasher{}
	hash, err := hasher.Hash("secret")
	require.NoError(t, err)

	container := testContainer(t, domainuser.User{
		Username: "alice", Email: "alice@example.com", Role: "admin", HashedPassword: hash,
	})
	h := authhandler.NewHandler(container)
	fiberApp := fiber.New()
	fiberApp.Post("/auth/login", h.Login)

	form := url.Values{}
	form.Set("uname_or_email", "alice@example.com")
	form.Set("password", "wrong-password")

	resp := postForm(t, fiberApp, "/auth/login", form)
	require.Equal(t, fiber.StatusUnauthorized, resp.StatusCode)
}

func TestHandlerLoginUserNotFoundReturns401(t *testing.T) {
	h := authhandler.NewHandler(testContainer(t))
	fiberApp := fiber.New()
	fiberApp.Post("/auth/login", h.Login)

	form := url.Values{}
	form.Set("uname_or_email", "ghost@example.com")
	form.Set("password", "any")

	resp := postForm(t, fiberApp, "/auth/login", form)
	require.Equal(t, fiber.StatusUnauthorized, resp.StatusCode)
}

func TestHandlerLoginSuccess(t *testing.T) {
	hasher := security.PasswordHasher{}
	hash, err := hasher.Hash("secret")
	require.NoError(t, err)

	container := testContainer(t, domainuser.User{
		Username: "alice", Email: "alice@example.com", Role: "admin", HashedPassword: hash,
	})
	h := authhandler.NewHandler(container)
	fiberApp := fiber.New()
	fiberApp.Post("/auth/login", h.Login)

	form := url.Values{}
	form.Set("uname_or_email", "alice")
	form.Set("password", "secret")

	resp := postForm(t, fiberApp, "/auth/login", form)
	require.Equal(t, fiber.StatusOK, resp.StatusCode)
}

func TestHandlerLoginMailUnknownUserReturns401(t *testing.T) {
	h := authhandler.NewHandler(testContainer(t))
	fiberApp := fiber.New()
	fiberApp.Post("/auth/login-mail", h.Login_mail)

	form := url.Values{}
	form.Set("uname_or_email", "ghost@example.com")
	resp := postForm(t, fiberApp, "/auth/login-mail", form)
	require.Equal(t, fiber.StatusUnauthorized, resp.StatusCode)
}

func TestHandlerLoginMailSuccess(t *testing.T) {
	container := testContainer(t, domainuser.User{
		Username: "alice", Email: "alice@example.com", Role: "admin",
	})
	h := authhandler.NewHandler(container)
	fiberApp := fiber.New()
	fiberApp.Post("/auth/login-mail", h.Login_mail)

	form := url.Values{}
	form.Set("uname_or_email", "alice@example.com")
	resp := postForm(t, fiberApp, "/auth/login-mail", form)
	require.Equal(t, fiber.StatusOK, resp.StatusCode)
}

func TestHandlerConfirmLoginInvalidTokenReturns401(t *testing.T) {
	h := authhandler.NewHandler(testContainer(t))
	fiberApp := fiber.New()
	fiberApp.Post("/auth/confirm-login-mail", h.Confirm_login_mail)

	form := url.Values{}
	form.Set("word", "bad-token")
	resp := postForm(t, fiberApp, "/auth/confirm-login-mail", form)
	require.Equal(t, fiber.StatusUnauthorized, resp.StatusCode)
	_, _ = io.Copy(io.Discard, resp.Body)
}

func TestHandlerConfirmLoginSuccess(t *testing.T) {
	links := inframemory.NewMagicLinkStore()
	require.NoError(t, links.Save(context.Background(), "lin123", "alice", time.Hour))

	container, err := app.New(app.Options{
		EnvType: "TEST", SecretKey: []byte("secret"), DomainPref: "https://example.com", Links: links,
	})
	require.NoError(t, err)

	h := authhandler.NewHandler(container)
	fiberApp := fiber.New()
	fiberApp.Post("/auth/confirm-login-mail", h.Confirm_login_mail)

	form := url.Values{}
	form.Set("word", "lin123")
	resp := postForm(t, fiberApp, "/auth/confirm-login-mail", form)
	require.Equal(t, fiber.StatusOK, resp.StatusCode)
}

func TestHandlerChangePasswordNotFoundReturns400(t *testing.T) {
	h := authhandler.NewHandler(testContainer(t))
	fiberApp := fiber.New()
	fiberApp.Post("/auth/change-password", h.Change_password)

	form := url.Values{}
	form.Set("uname_or_email", "missing")
	resp := postForm(t, fiberApp, "/auth/change-password", form)
	require.Equal(t, fiber.StatusBadRequest, resp.StatusCode)
}

func TestHandlerConfirmPasswordInvalidTokenReturns401(t *testing.T) {
	h := authhandler.NewHandler(testContainer(t))
	fiberApp := fiber.New()
	fiberApp.Post("/auth/confirm-password-change", h.Confirm_password_change)

	form := url.Values{}
	form.Set("word", "bad")
	form.Set("password", "new")
	resp := postForm(t, fiberApp, "/auth/confirm-password-change", form)
	require.Equal(t, fiber.StatusUnauthorized, resp.StatusCode)
}

func TestHandlerRenewTokenUnauthorized(t *testing.T) {
	container := testContainer(t)
	h := authhandler.NewHandler(container)
	fiberApp := fiber.New()
	fiberApp.Post("/auth/renew-token", func(c *fiber.Ctx) error {
		c.Locals("user", jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"name": "ghost", "role": "admin",
		}))
		return h.Renew_token(c)
	})

	resp := postForm(t, fiberApp, "/auth/renew-token", url.Values{})
	require.Equal(t, fiber.StatusUnauthorized, resp.StatusCode)
}

func TestHandlerRenewTokenSuccess(t *testing.T) {
	container := testContainer(t, domainuser.User{
		Username: "alice", Email: "alice@example.com", Role: "admin",
	})
	h := authhandler.NewHandler(container)
	fiberApp := fiber.New()
	fiberApp.Post("/auth/renew-token", func(c *fiber.Ctx) error {
		c.Locals("user", jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"name": "alice", "role": "admin",
		}))
		return h.Renew_token(c)
	})

	resp := postForm(t, fiberApp, "/auth/renew-token", url.Values{})
	require.Equal(t, fiber.StatusOK, resp.StatusCode)
}

func TestMagicLinkConsumeMissingToken(t *testing.T) {
	store := inframemory.NewMagicLinkStore()
	_, err := store.Consume(context.Background(), "missing")
	require.ErrorIs(t, err, domainauth.ErrTokenNotFound)
}

func TestLoginMailSendsEmail(t *testing.T) {
	mailSender := inframailmemory.NewSender()
	container, err := app.New(app.Options{
		EnvType: "TEST", SecretKey: []byte("s"), DomainPref: "https://x",
		Mail: mailSender,
		Users: inframemory.NewUserRepository(domainuser.User{
			Username: "u", Email: "u@example.com", Role: "admin",
		}),
	})
	require.NoError(t, err)
	h := authhandler.NewHandler(container)
	fiberApp := fiber.New()
	fiberApp.Post("/auth/login-mail", h.Login_mail)

	form := url.Values{}
	form.Set("uname_or_email", "u@example.com")
	resp := postForm(t, fiberApp, "/auth/login-mail", form)
	require.Equal(t, fiber.StatusOK, resp.StatusCode)
	require.Len(t, mailSender.Messages, 1)
}
