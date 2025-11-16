package common

import (
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"admin/settings"
)

func WriteLog(format string, a ...any) (n int, err error) {
	return fmt.Printf(
		time.Now().Format("2006-01-02 15:04:05.00000 -07:00 MST")+"> "+format+"\n",
		a...,
	)
}

func WriteLogFatal(format string, a ...any) {
	fmt.Printf(
		time.Now().Format("2006-01-02 15:04:05.00000 -07:00 MST")+" FATAL> "+format+"\n",
		a...,
	)
	os.Exit(1)
}

func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

func CheckPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func GetToken(user string, role string) (string, error) {
	claims := jwt.MapClaims{
		"name":    user,
		"role":    role,
		"created": time.Now().Unix(),
		"exp":     time.Now().Add(time.Hour * 24 * 30).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	WriteLog("Created token for %s %s", role, user)

	return token.SignedString(settings.SECRET_KEY)
}
