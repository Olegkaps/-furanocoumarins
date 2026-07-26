package auth

import "errors"

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUserNotFound       = errors.New("user not found")
	ErrWrongPassword      = errors.New("wrong password")
	ErrInvalidToken       = errors.New("invalid or expired token")
)
