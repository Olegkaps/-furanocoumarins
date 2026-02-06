package common

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"admin/settings"
	"admin/utils/logging"
)

func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

func CheckPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func GetToken(c *fiber.Ctx, user string, role string) (string, error) {
	claims := jwt.MapClaims{
		"name":    user,
		"role":    role,
		"created": time.Now().Unix(),
		"exp":     time.Now().Add(time.Hour * 24 * 30).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	logging.Info(c, "Created token for %s %s", role, user)

	return token.SignedString(settings.SECRET_KEY)
}
