package authmaster

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
)

type fakeAuth struct {
	user    infraauth.User
	meErr   error
	has     bool
	roleErr error
}

func (f *fakeAuth) Request(context.Context, string, string, string, io.Reader, string) (*http.Response, error) {
	return nil, errors.New("unused")
}
func (f *fakeAuth) RequestWithCredentials(context.Context, string, string, string, string, string, io.Reader, string) (*http.Response, error) {
	return nil, errors.New("unused")
}
func (f *fakeAuth) Me(context.Context, string) (infraauth.User, error)    { return f.user, f.meErr }
func (f *fakeAuth) HasRole(context.Context, string, string) (bool, error) { return f.has, f.roleErr }

func TestAuthorizationMiddlewareDistinguishesCredentialFailureOutageAndRole(t *testing.T) {
	for _, test := range []struct {
		name   string
		fake   *fakeAuth
		status int
		stale  bool
	}{
		{"invalid", &fakeAuth{meErr: &infraauth.StatusError{Status: 401}}, 401, false},
		{"stale", &fakeAuth{meErr: &infraauth.StatusError{Status: 401, TokenStale: true}}, 401, true},
		{"outage", &fakeAuth{meErr: errors.New("dial failed")}, 503, false},
		{"non-admin", &fakeAuth{user: infraauth.User{Login: "user"}, has: false}, 403, false},
		{"admin", &fakeAuth{user: infraauth.User{Login: "admin"}, has: true}, 204, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			application := fiber.New()
			application.Post("/mutation", RequireAdmin(&app.Container{AuthMaster: test.fake}), func(c *fiber.Ctx) error { return c.SendStatus(204) })
			req := httptest.NewRequest(http.MethodPost, "/mutation", nil)
			req.Header.Set("Authorization", "Bearer test")
			response, err := application.Test(req)
			require.NoError(t, err)
			require.Equal(t, test.status, response.StatusCode)
			if test.stale {
				require.Equal(t, "1", response.Header.Get("X-Token-Stale"))
			} else {
				require.Empty(t, response.Header.Get("X-Token-Stale"))
			}
		})
	}
}
