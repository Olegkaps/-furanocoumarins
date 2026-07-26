package deps

import (
	"fmt"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
)

func jwtClaims(c *fiber.Ctx) (jwt.MapClaims, error) {
	user, ok := c.Locals("user").(*jwt.Token)
	if !ok || user == nil {
		return nil, fmt.Errorf("missing auth token")
	}
	claims, ok := user.Claims.(jwt.MapClaims)
	if !ok {
		return nil, fmt.Errorf("invalid token claims")
	}
	return claims, nil
}

func JWTUsername(c *fiber.Ctx) (string, error) {
	claims, err := jwtClaims(c)
	if err != nil {
		return "", err
	}
	name, ok := claims["name"].(string)
	if !ok || name == "" {
		return "", fmt.Errorf("missing username in token")
	}
	return name, nil
}

func JWTRole(c *fiber.Ctx) (string, error) {
	claims, err := jwtClaims(c)
	if err != nil {
		return "", err
	}
	role, ok := claims["role"].(string)
	if !ok || role == "" {
		return "", fmt.Errorf("missing role in token")
	}
	return role, nil
}
