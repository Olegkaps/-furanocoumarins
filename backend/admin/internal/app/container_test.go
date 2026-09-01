package app_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"admin/internal/app"
)

func TestNewTestContainer(t *testing.T) {
	opts := app.DefaultOptions()
	opts.EnvType = "TEST"

	container, err := app.New(opts)
	require.NoError(t, err)
	require.NotNil(t, container.Auth)
	require.NotNil(t, container.Search)
	require.NotNil(t, container.Mail)
	require.NoError(t, container.Closer())
}

func TestNewAutotestContainer(t *testing.T) {
	container, err := app.New(app.Options{EnvType: "AUTOTEST"})
	require.NoError(t, err)
	require.NotNil(t, container.Auth)
}

func TestProductionContainerDoesNotConstructLegacyIdentityStores(t *testing.T) {
	opts := app.DefaultOptions()
	opts.EnvType = "PROD"
	// These deliberately unusable endpoints would fail New immediately if the
	// production path still opened the legacy users DB or Redis token store.
	opts.PostgresDSN = "postgres://invalid.invalid/legacy-users"
	opts.RedisOpts.Addr = "invalid.invalid:6379"

	container, err := app.New(opts)
	require.NoError(t, err)
	require.Nil(t, container.Auth)
	require.Nil(t, container.Users)
	require.Nil(t, container.Persistence.DB)
	require.Nil(t, container.Persistence.Redis)
	require.NotNil(t, container.AuthMaster)
	require.NotNil(t, container.Cassandra)
	require.NotNil(t, container.Search)
	require.NoError(t, container.Closer())
}
