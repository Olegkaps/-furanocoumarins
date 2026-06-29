package security_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"admin/internal/infrastructure/security"
)

func TestPasswordHasherHashAndVerifyPositive(t *testing.T) {
	hasher := security.PasswordHasher{}
	hash, err := hasher.Hash("password")
	require.NoError(t, err)
	require.True(t, hasher.Verify("password", hash))
}

func TestPasswordHasherVerifyNegative(t *testing.T) {
	hasher := security.PasswordHasher{}
	hash, err := hasher.Hash("password")
	require.NoError(t, err)
	require.False(t, hasher.Verify("wrong", hash))
}

func TestTokenIssuerIssuePositive(t *testing.T) {
	issuer := security.NewTokenIssuer([]byte("secret"))
	token, err := issuer.Issue("alice", "admin")
	require.NoError(t, err)
	require.NotEmpty(t, token)
}

func TestTokenIssuerIssueNegativeEmptySecret(t *testing.T) {
	issuer := security.NewTokenIssuer([]byte(""))
	token, err := issuer.Issue("alice", "admin")
	require.NoError(t, err)
	require.NotEmpty(t, token)
}
