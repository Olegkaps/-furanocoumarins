package user_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	domainuser "admin/internal/domain/user"
	"admin/internal/infrastructure/security"
)

func TestUserCanAuthenticateWith(t *testing.T) {
	hasher := security.PasswordHasher{}
	hash, err := hasher.Hash("secret")
	assert.NoError(t, err)

	user := domainuser.User{HashedPassword: hash}
	assert.True(t, user.CanAuthenticateWith("secret", hasher.Verify))
	assert.False(t, user.CanAuthenticateWith("wrong", hasher.Verify))
}
