package memory_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	domainauth "admin/internal/domain/auth"
	inframemory "admin/internal/infrastructure/persistence/memory"
)

func TestMagicLinkStoreSaveAndConsume(t *testing.T) {
	store := inframemory.NewMagicLinkStore()
	require.NoError(t, store.Save(context.Background(), "tok", "user", time.Hour))

	username, err := store.Consume(context.Background(), "tok")
	require.NoError(t, err)
	require.Equal(t, "user", username)
}

func TestMagicLinkStoreConsumeTwiceFails(t *testing.T) {
	store := inframemory.NewMagicLinkStore()
	require.NoError(t, store.Save(context.Background(), "tok", "user", time.Hour))
	_, err := store.Consume(context.Background(), "tok")
	require.NoError(t, err)
	_, err = store.Consume(context.Background(), "tok")
	require.ErrorIs(t, err, domainauth.ErrTokenNotFound)
}

func TestMagicLinkStoreExpiredToken(t *testing.T) {
	store := inframemory.NewMagicLinkStore()
	require.NoError(t, store.Save(context.Background(), "expired", "user", -time.Second))
	_, err := store.Consume(context.Background(), "expired")
	require.ErrorIs(t, err, domainauth.ErrTokenNotFound)
}
