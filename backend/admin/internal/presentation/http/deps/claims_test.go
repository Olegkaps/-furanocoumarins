package deps_test

import (
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"admin/internal/presentation/http/deps"
)

func TestJWTUsernamePositive(t *testing.T) {
	app := fiber.New()
	app.Get("/", func(c *fiber.Ctx) error {
		c.Locals("user", jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"name": "alice", "role": "admin",
		}))
		name, err := deps.JWTUsername(c)
		require.NoError(t, err)
		assert.Equal(t, "alice", name)
		return nil
	})

	resp, err := app.Test(httptest.NewRequest(fiber.MethodGet, "/", nil))
	require.NoError(t, err)
	require.Equal(t, fiber.StatusOK, resp.StatusCode)
}

func TestJWTUsernameNegativeMissingToken(t *testing.T) {
	app := fiber.New()
	app.Get("/", func(c *fiber.Ctx) error {
		_, err := deps.JWTUsername(c)
		assert.Error(t, err)
		return nil
	})

	resp, err := app.Test(httptest.NewRequest(fiber.MethodGet, "/", nil))
	require.NoError(t, err)
	require.Equal(t, fiber.StatusOK, resp.StatusCode)
}
