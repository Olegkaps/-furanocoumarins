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
