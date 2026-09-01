package authmaster

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func clearImportEnvironment(t *testing.T) {
	t.Helper()
	for _, name := range []string{"FURANO_SOURCE_DATABASE_URL", "DATABASE_URL", "FURANO_SUPERUSER"} {
		t.Setenv(name, "")
		_ = os.Unsetenv(name)
		_ = os.Unsetenv(name + "_FILE")
	}
}

func TestLoadSettingsFromEnvironmentSupportsStrictFileInputs(t *testing.T) {
	clearImportEnvironment(t)
	wants := map[string]string{
		"FURANO_SOURCE_DATABASE_URL": "postgres://source:secret@source/source",
		"DATABASE_URL":               "postgres://target:secret@target/auth",
		"FURANO_SUPERUSER":           "Mixed.User@Example.Test",
	}
	for name, value := range wants {
		path := filepath.Join(t.TempDir(), strings.ToLower(name))
		require.NoError(t, os.WriteFile(path, []byte(value+"\r\n"), 0o600))
		t.Setenv(name+"_FILE", path)
	}
	got, err := LoadSettingsFromEnvironment()
	require.NoError(t, err)
	require.Equal(t, wants["FURANO_SOURCE_DATABASE_URL"], got.SourceDatabaseURL)
	require.Equal(t, wants["DATABASE_URL"], got.TargetDatabaseURL)
	require.Equal(t, wants["FURANO_SUPERUSER"], got.SelectedSuperuser)
}

func TestEnvOrFileRejectsAmbiguousEmptyOversizeAndNULWithoutSecretLeak(t *testing.T) {
	const name = "FURANO_SOURCE_DATABASE_URL"
	const secret = "super-private-dsn-password"
	tests := []struct {
		name   string
		direct *string
		data   []byte
		want   string
	}{
		{name: "empty", data: []byte("\n"), want: "is empty"},
		{name: "oversize", data: []byte(strings.Repeat("x", maxSecretFileBytes+1)), want: "exceeds"},
		{name: "NUL", data: []byte("postgres://user:" + secret + "@db/auth\x00tail"), want: "NUL byte"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			clearImportEnvironment(t)
			path := filepath.Join(t.TempDir(), "secret")
			require.NoError(t, os.WriteFile(path, tc.data, 0o600))
			t.Setenv(name+"_FILE", path)
			_, err := envOrFile(name)
			require.ErrorContains(t, err, tc.want)
			require.NotContains(t, err.Error(), secret)
			require.NotContains(t, err.Error(), path)
		})
	}

	t.Run("direct and file", func(t *testing.T) {
		clearImportEnvironment(t)
		path := filepath.Join(t.TempDir(), "secret")
		require.NoError(t, os.WriteFile(path, []byte("file-secret"), 0o600))
		t.Setenv(name, secret)
		t.Setenv(name+"_FILE", path)
		_, err := envOrFile(name)
		require.ErrorContains(t, err, "cannot both be set")
		require.NotContains(t, err.Error(), secret)
	})

	t.Run("oversize direct", func(t *testing.T) {
		clearImportEnvironment(t)
		t.Setenv(name, strings.Repeat("x", maxSecretFileBytes+1))
		_, err := envOrFile(name)
		require.ErrorContains(t, err, "exceeds")
	})
}

func TestLoadSettingsMissingAndDatabaseErrorsAreRedacted(t *testing.T) {
	clearImportEnvironment(t)
	_, err := LoadSettingsFromEnvironment()
	require.ErrorContains(t, err, "are required")

	const secret = "SUPER-SECRET-PASSWORD"
	_, err = openDatabase(context.Background(), "postgres://user:"+secret+"@%invalid-host/database", "source")
	require.Error(t, err)
	require.NotContains(t, err.Error(), secret)
	require.NotContains(t, err.Error(), "%invalid-host")
}
