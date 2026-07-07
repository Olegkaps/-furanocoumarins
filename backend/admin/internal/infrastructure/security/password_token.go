package security

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"admin/settings"
)

type PasswordHasher struct{}

func bcryptCost() int {
	if settings.C.EnvType == "TEST" || settings.C.EnvType == "AUTOTEST" {
		return bcrypt.MinCost
	}
	return 14
}

func (PasswordHasher) Hash(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost())
	return string(bytes), err
}

func (PasswordHasher) Verify(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

type TokenIssuer struct {
	secret []byte
}

func NewTokenIssuer(secret []byte) *TokenIssuer {
	return &TokenIssuer{secret: secret}
}

func (t *TokenIssuer) Issue(username, role string) (string, error) {
	claims := jwt.MapClaims{
		"name":    username,
		"role":    role,
		"created": time.Now().Unix(),
		"exp":     time.Now().Add(time.Hour * 24 * 30).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(t.secret)
}
