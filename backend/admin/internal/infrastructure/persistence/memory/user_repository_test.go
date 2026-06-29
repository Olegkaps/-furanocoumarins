package memory_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	domainuser "admin/internal/domain/user"
	inframemory "admin/internal/infrastructure/persistence/memory"
)

func TestUserRepositoryFindAndUpdate(t *testing.T) {
	repo := inframemory.NewUserRepository(domainuser.User{
		Username: "a",
		Email:    "a@x.com",
		Role:     "admin",
	})

	user, err := repo.FindByLoginOrEmail(context.Background(), "a@x.com")
	require.NoError(t, err)
	require.Equal(t, "a", user.Username)

	require.NoError(t, repo.UpdatePassword(context.Background(), "a", "hash"))
	user, err = repo.FindByLoginOrEmail(context.Background(), "a")
	require.NoError(t, err)
	require.Equal(t, "hash", user.HashedPassword)
}

func TestUserRepositoryNotFound(t *testing.T) {
	repo := inframemory.NewUserRepository()
	_, err := repo.FindByLoginOrEmail(context.Background(), "missing")
	require.ErrorIs(t, err, inframemory.ErrNotFound)
}

func TestUserRepositoryExistsWithRole(t *testing.T) {
	repo := inframemory.NewUserRepository(domainuser.User{
		Username: "bob", Email: "bob@x.com", Role: "viewer",
	})
	exists, err := repo.ExistsWithRole(context.Background(), "bob@x.com", "viewer")
	require.NoError(t, err)
	require.True(t, exists)

	exists, err = repo.ExistsWithRole(context.Background(), "bob@x.com", "admin")
	require.NoError(t, err)
	require.False(t, exists)
}
