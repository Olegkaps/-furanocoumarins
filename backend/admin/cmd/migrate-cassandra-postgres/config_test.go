package main

import (
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/lib/pq"
	"github.com/stretchr/testify/require"
)

func secret(t *testing.T, value string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "secret")
	require.NoError(t, os.WriteFile(path, []byte(value), 0600))
	return path
}

func cleanConfig(t *testing.T) {
	t.Helper()
	for _, name := range []string{"FURANO_CASSANDRA_HOST", "FURANO_POSTGRES_DSN", "PG_HOST", "PG_PORT", "PG_USER", "PG_PASSWORD", "PG_DB", "PG_SSLMODE"} {
		for _, key := range []string{name, name + "_FILE"} {
			t.Setenv(key, "") // Register restoration before unsetting.
			require.NoError(t, os.Unsetenv(key))
		}
	}
}

func TestSettingFiles(t *testing.T) {
	for _, tc := range []struct{ name, input, want string }{
		{"newline", "password\n", "password"},
		{"windows newline", "password\r\n", "password"},
		{"preserve spaces", " password \n", " password "},
		{"no newline", "password", "password"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cleanConfig(t)
			t.Setenv("PG_PASSWORD_FILE", secret(t, tc.input))
			value, err := required("PG_PASSWORD")
			require.NoError(t, err)
			require.Equal(t, tc.want, value)
		})
	}
}

func TestSettingFailuresDoNotExposeSecrets(t *testing.T) {
	for _, mode := range []string{"empty", "missing", "conflict", "empty direct conflict"} {
		t.Run(mode, func(t *testing.T) {
			cleanConfig(t)
			path := secret(t, "\r\n")
			if mode == "missing" {
				path += "-sensitive-name"
			}
			t.Setenv("PG_PASSWORD_FILE", path)
			if mode == "conflict" {
				t.Setenv("PG_PASSWORD", "sensitive-value")
			}
			if mode == "empty direct conflict" {
				t.Setenv("PG_PASSWORD", "")
			}
			_, err := required("PG_PASSWORD")
			require.Error(t, err)
			require.NotContains(t, err.Error(), path)
			require.NotContains(t, err.Error(), "sensitive-value")
		})
	}
}

func TestConfigDirectAndFileDSN(t *testing.T) {
	for _, file := range []bool{false, true} {
		cleanConfig(t)
		const dsn = "postgres://u:p@postgres/db?sslmode=disable"
		if file {
			t.Setenv("FURANO_CASSANDRA_HOST_FILE", secret(t, "cassandra\n"))
			t.Setenv("FURANO_POSTGRES_DSN_FILE", secret(t, dsn+"\n"))
		} else {
			t.Setenv("FURANO_CASSANDRA_HOST", "cassandra")
			t.Setenv("FURANO_POSTGRES_DSN", dsn)
		}
		cfg, err := config()
		require.NoError(t, err)
		require.Equal(t, settings{host: "cassandra", dsn: dsn}, cfg)
		// An explicit full DSN overrides component configuration.
		t.Setenv("PG_PASSWORD_FILE", "/nonexistent/unused-secret")
		cfg, err = config()
		require.NoError(t, err)
		require.Equal(t, dsn, cfg.dsn)
	}
}

func TestConfigSwarmComponents(t *testing.T) {
	cleanConfig(t)
	t.Setenv("FURANO_CASSANDRA_HOST", "cassandra")
	t.Setenv("PG_HOST", "::1")
	values := map[string]string{"PG_USER": "a@b:/?", "PG_PASSWORD": " space'@&/=?#% ", "PG_DB": "db/name?#%"}
	for key, value := range values {
		t.Setenv(key+"_FILE", secret(t, value+"\n"))
	}
	cfg, err := config()
	require.NoError(t, err)
	u, err := url.Parse(cfg.dsn)
	require.NoError(t, err)
	require.Equal(t, values["PG_USER"], u.User.Username())
	password, _ := u.User.Password()
	require.Equal(t, values["PG_PASSWORD"], password)
	require.Equal(t, "/"+values["PG_DB"], u.Path)
	require.Equal(t, "[::1]:5432", u.Host)
	require.Equal(t, "require", u.Query().Get("sslmode"))
	parsed, err := pq.ParseURL(cfg.dsn)
	require.NoError(t, err)
	require.Contains(t, parsed, "user='a@b:/?'")
	require.Contains(t, parsed, "password=' space\\'@&/=?#% '")
	require.Contains(t, parsed, "dbname='db/name?#%'")
	t.Setenv("PG_PORT", "5433")
	t.Setenv("PG_SSLMODE", "disable")
	cfg, err = config()
	require.NoError(t, err)
	u, err = url.Parse(cfg.dsn)
	require.NoError(t, err)
	require.Equal(t, "[::1]:5433", u.Host)
	require.Equal(t, "disable", u.Query().Get("sslmode"))
	for _, port := range []string{"0", "65536", "secret-bad-port"} {
		t.Setenv("PG_PORT", port)
		_, err = config()
		require.Error(t, err)
		require.NotContains(t, err.Error(), "secret-bad-port")
	}
	t.Setenv("PG_PORT", "5432")
	t.Setenv("PG_SSLMODE", "unsafe-secret-value")
	_, err = config()
	require.ErrorContains(t, err, "PG_SSLMODE")
	require.NotContains(t, err.Error(), "unsafe-secret-value")
}

func TestConfigRequiresExplicitEndpointsAndComponents(t *testing.T) {
	for _, missing := range []string{"FURANO_CASSANDRA_HOST", "PG_HOST", "PG_USER", "PG_PASSWORD", "PG_DB"} {
		t.Run(missing, func(t *testing.T) {
			cleanConfig(t)
			for _, key := range []string{"FURANO_CASSANDRA_HOST", "PG_HOST", "PG_USER", "PG_PASSWORD", "PG_DB"} {
				if key != missing {
					t.Setenv(key, "value")
				}
			}
			_, err := config()
			require.ErrorContains(t, err, missing)
		})
	}
}
