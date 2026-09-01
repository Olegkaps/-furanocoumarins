package authmaster

import (
	"errors"
	"strings"

	"github.com/gofiber/fiber/v2"

	"admin/internal/app"
	infraauth "admin/internal/infrastructure/authmaster"
)

const userLocal = "auth-master-user"

func RequireUser(container *app.Container) fiber.Handler {
	return func(c *fiber.Ctx) error {
		bearer := strings.TrimSpace(c.Get("Authorization"))
		if !strings.HasPrefix(bearer, "Bearer ") {
			return fiber.ErrUnauthorized
		}
		user, err := container.AuthMaster.Me(c.UserContext(), bearer)
		if err != nil {
			return authError(c, err)
		}
		c.Locals(userLocal, user)
		return c.Next()
	}
}

func RequireAdmin(container *app.Container) fiber.Handler {
	return func(c *fiber.Ctx) error {
		bearer := strings.TrimSpace(c.Get("Authorization"))
		if !strings.HasPrefix(bearer, "Bearer ") {
			return fiber.ErrUnauthorized
		}
		user, err := container.AuthMaster.Me(c.UserContext(), bearer)
		if err != nil {
			return authError(c, err)
		}
		has, err := container.AuthMaster.HasRole(c.UserContext(), bearer, "admin")
		if err != nil {
			return authError(c, err)
		}
		if !has {
			return fiber.ErrForbidden
		}
		c.Locals(userLocal, user)
		return c.Next()
	}
}

func RequireSuperuser(container *app.Container) fiber.Handler {
	return func(c *fiber.Ctx) error {
		bearer := strings.TrimSpace(c.Get("Authorization"))
		user, err := container.AuthMaster.Me(c.UserContext(), bearer)
		if err != nil {
			return authError(c, err)
		}
		if !user.Superuser {
			return fiber.ErrForbidden
		}
		c.Locals(userLocal, user)
		return c.Next()
	}
}

func authError(c *fiber.Ctx, err error) error {
	var status *infraauth.StatusError
	if errors.As(err, &status) {
		if status.TokenStale {
			c.Set("X-Token-Stale", "1")
		}
		switch status.Status {
		case fiber.StatusUnauthorized:
			return fiber.ErrUnauthorized
		case fiber.StatusForbidden:
			return fiber.ErrForbidden
		}
	}
	return fiber.NewError(fiber.StatusServiceUnavailable, "authorization service unavailable")
}
