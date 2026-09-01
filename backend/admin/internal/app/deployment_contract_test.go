package app_test

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

func repositoryRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	require.True(t, ok)
	return filepath.Clean(filepath.Join(filepath.Dir(file), "../../../.."))
}

func readRepositoryFile(t *testing.T, name string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(repositoryRoot(t), name))
	require.NoError(t, err)
	return string(data)
}

func TestProductionAuthDeploymentContract(t *testing.T) {
	root := repositoryRoot(t)
	_, err := os.Stat(filepath.Join(root, "docker-compose.yaml"))
	require.ErrorIs(t, err, os.ErrNotExist, "the upstream-deleted legacy Compose file must not be resurrected")

	var stack struct {
		Services map[string]struct {
			Image       string            `yaml:"image"`
			Environment map[string]string `yaml:"environment"`
			Ports       []any             `yaml:"ports"`
			Secrets     []string          `yaml:"secrets"`
			Networks    []string          `yaml:"networks"`
			DependsOn   map[string]any    `yaml:"depends_on"`
			Healthcheck map[string]any    `yaml:"healthcheck"`
			Deploy      map[string]any    `yaml:"deploy"`
			Volumes     []string          `yaml:"volumes"`
		} `yaml:"services"`
		Secrets map[string]any `yaml:"secrets"`
	}
	require.NoError(t, yaml.Unmarshal([]byte(readRepositoryFile(t, "deploy/swarm/stack.yaml")), &stack))

	authd, ok := stack.Services["authd"]
	require.True(t, ok)
	require.Contains(t, authd.Image, "AUTH_MASTER_IMAGE")
	require.Empty(t, authd.Ports, "authd must remain private")
	require.Contains(t, authd.Networks, "back")
	require.NotEmpty(t, authd.Healthcheck)
	require.Contains(t, authd.Deploy, "resources")
	require.Contains(t, authd.Deploy, "restart_policy")
	for key, path := range map[string]string{
		"DATABASE_URL_FILE":                     "/run/secrets/auth_database_url",
		"PASSWORD_HISTORY_ENCRYPTION_KEY_FILE":  "/run/secrets/auth_password_history_key",
		"SIGNING_KEY_MASTER_KEY_FILE":           "/run/secrets/auth_signing_key",
		"MAGIC_LINK_CALLBACK_URL_FILE":          "/run/secrets/auth_magic_callback_url",
		"REGISTRATION_INVITE_CALLBACK_URL_FILE": "/run/secrets/auth_invite_callback_url",
	} {
		require.Equal(t, path, authd.Environment[key])
	}
	require.Equal(t, "true", authd.Environment["REFRESH_COOKIE_SECURE"], "production refresh cookies must be HTTPS-only")

	authPostgres, ok := stack.Services["auth-postgres"]
	require.True(t, ok)
	require.Contains(t, authPostgres.Image, "AUTH_POSTGRES_IMAGE")
	require.Empty(t, authPostgres.Ports, "auth PostgreSQL must remain private")
	require.Contains(t, authPostgres.Networks, "back")
	require.NotEmpty(t, authPostgres.Healthcheck)
	require.Contains(t, authPostgres.Deploy, "resources")
	require.Contains(t, authPostgres.Deploy, "restart_policy")
	require.Contains(t, authPostgres.Volumes, "auth_postgres_data:/var/lib/postgresql/data")

	goAuth := stack.Services["go-auth"]
	require.Contains(t, goAuth.Image, "FURANO_BACKEND_IMAGE")
	require.Equal(t, "http://authd:8080", goAuth.Environment["AUTH_MASTER_URL"])
	require.Equal(t, "${FURAN_SMTP_TIMEOUT:-5s}", goAuth.Environment["SMTP_TIMEOUT"])
	require.Contains(t, goAuth.DependsOn, "authd")
	require.NotContains(t, goAuth.DependsOn, "postgres")
	require.NotContains(t, goAuth.DependsOn, "redis")

	for _, secret := range []string{
		"auth_database_url",
		"auth_password_history_key", "auth_signing_key", "auth_magic_callback_url",
		"auth_invite_callback_url",
	} {
		require.Contains(t, stack.Secrets, secret)
	}
	require.NotContains(t, stack.Secrets, "auth_source_database_url", "migration source must not be attached to the persistent stack")
	require.NotContains(t, stack.Secrets, "auth_selected_superuser", "migration identity must not be attached to the persistent stack")
}

func TestLocalRuntimeDoesNotDependOnLegacyIdentityStores(t *testing.T) {
	var compose struct {
		Services map[string]struct {
			DependsOn map[string]any `yaml:"depends_on"`
		} `yaml:"services"`
	}
	require.NoError(t, yaml.Unmarshal([]byte(readRepositoryFile(t, "docker-compose.local.yaml")), &compose))
	goAuth := compose.Services["go-auth"]
	require.Contains(t, goAuth.DependsOn, "authd")
	require.NotContains(t, goAuth.DependsOn, "postgres")
	require.NotContains(t, goAuth.DependsOn, "redis")
	importer := compose.Services["auth-import"]
	require.Contains(t, importer.DependsOn, "postgres", "legacy PostgreSQL remains only as the offline migration source")
	require.Contains(t, importer.DependsOn, "auth-postgres")
}

func TestQAManualMatchesCurrentAuthAndTestContract(t *testing.T) {
	manual := readRepositoryFile(t, "docs/QA_MANUAL.md")
	for _, required := range []string{
		"make auth-import",
		"make lint",
		"make test-unit",
		"make test-race",
		"make test-integration",
		"make test-e2e",
		"make test",
		"/admit?token=",
		"/register?token=",
		"/auth/login-verify-otp",
		"/auth/password-reset/start",
		"/auth/password-reset/complete",
		"/auth/refresh",
		"/auth/logout",
		"^[A-Za-z][A-Za-z0-9_]*$",
		"LocalSerial",
		"Playwright",
		"live Cassandra import/search",
	} {
		require.Contains(t, manual, required)
	}

	for _, obsolete := range []string{
		"./cli create_admin",
		"/auth/renew-token",
		"/admit/:code",
		"client-only",
		"Автотесты почти только на backend",
		"весь frontend",
		"без санитизации идентификаторов",
	} {
		require.NotContains(t, manual, obsolete)
	}
}

func TestOneShotImportDeploymentContract(t *testing.T) {
	script := readRepositoryFile(t, "deploy/swarm/scripts/run-auth-import.sh")
	for _, required := range []string{
		"FURANO_IMPORT_IMAGE", "@sha256:", "auth_source_database_url",
		"auth_database_url", "auth_selected_superuser", "FURANO_SOURCE_DATABASE_URL_FILE",
		"DATABASE_URL_FILE", "FURANO_SUPERUSER_FILE", "--restart-condition none",
		`"${FURANO_IMPORT_IMAGE}"`, `"${GO_AUTH_SERVICE}=0"`,
		`"${AUTHD_SERVICE}=0"`, "CurrentState",
		"New|Pending|Assigned|Accepted|Preparing|Ready|Starting|Running", "restore_services",
	} {
		require.Contains(t, script, required)
	}
	require.NotContains(t, script, "postgres://", "DSNs must come only from secret files")
	require.NotContains(t, script, `"${AUTH_MASTER_IMAGE}"`, "the side-owned importer must not reuse the authd image")
	waitOffset := strings.Index(script, "CurrentState")
	createOffset := strings.Index(script, "docker service create")
	require.Greater(t, waitOffset, 0)
	require.Greater(t, createOffset, waitOffset, "writer-stop polling must precede importer creation")

	initSecrets := readRepositoryFile(t, "deploy/swarm/scripts/init-secrets.sh")
	for _, variable := range []string{
		"AUTH_DATABASE_URL_FILE", "FURANO_SOURCE_DATABASE_URL_FILE", "FURANO_SUPERUSER_FILE",
		"AUTH_MAGIC_CALLBACK_URL_FILE", "AUTH_INVITE_CALLBACK_URL_FILE",
	} {
		require.Contains(t, initSecrets, variable)
	}
	deploy := readRepositoryFile(t, "deploy/swarm/scripts/deploy.sh")
	require.Contains(t, deploy, "require_digest_image FURANO_BACKEND_IMAGE")
	require.NotContains(t, deploy, "auth_source_database_url")
	require.NotContains(t, deploy, "auth_selected_superuser")
	require.Contains(t, deploy, "validate_callback_secret auth_magic_callback_url /admit")
	require.Contains(t, deploy, "validate_callback_secret auth_invite_callback_url /register")
	require.Contains(t, deploy, "External BrowserRouter callback")
	require.Contains(t, deploy, "--write-out '%{http_code}'")
	require.Contains(t, initSecrets, `normalize_callback_secret_file "${AUTH_MAGIC_CALLBACK_URL_FILE:-}"`)
	require.Contains(t, initSecrets, `normalize_callback_secret_file "${AUTH_INVITE_CALLBACK_URL_FILE:-}"`)
	require.Contains(t, initSecrets, "create_normalized_callback_secret auth_magic_callback_url")
	require.Contains(t, initSecrets, "create_normalized_callback_secret auth_invite_callback_url")
	require.Contains(t, initSecrets, "validate_spa_origin_contract")
	require.Contains(t, initSecrets, "furanocoumarins.allow-origin")
	require.Contains(t, deploy, "validate_go_auth_origin")

	makefile := readRepositoryFile(t, "Makefile")
	require.Contains(t, makefile, "test: compose-check")
	require.Contains(t, makefile, "deploy/swarm/stack.yaml config")
	require.Contains(t, makefile, "FURANO_IMPORT_IMAGE")
	require.Contains(t, makefile, "FURANO_BACKEND_IMAGE")
	require.True(t, strings.Contains(makefile, "bash -n deploy/swarm/scripts"))
	require.Contains(t, makefile, "./deploy/swarm/scripts/callback-url_test.sh")
	require.Contains(t, makefile, "./deploy/swarm/scripts/callback-secret_test.sh")

	backendMain := readRepositoryFile(t, "backend/admin/main.go")
	require.Contains(t, backendMain, "EnsureActivationSchema(startupCtx)")
	require.Contains(t, backendMain, "context.WithTimeout")
	e2eHarness := readRepositoryFile(t, "scripts/auth-e2e.sh")
	require.Contains(t, e2eHarness, "legacy-upgrade-fixture")
	require.Contains(t, e2eHarness, "SELECT active_created_at FROM chemdb.table_activation")
	require.Contains(t, makefile, "./deploy/swarm/scripts/deploy_test.sh")
	callbackTest := readRepositoryFile(t, "deploy/swarm/scripts/callback-url_test.sh")
	for _, rejected := range []string{"?next=/admin", "#token", "user@frontend.example", "user:pass@frontend.example", "localhost", "127.0.0.1", "127.99.1.2", "[::1]", "'*'", "frontend.example,https://other.example", "https://other.example"} {
		require.Contains(t, callbackTest, rejected)
	}
	callbackSecretTest := readRepositoryFile(t, "deploy/swarm/scripts/callback-secret_test.sh")
	for _, rejected := range []string{"front.example\\n/admit", "front.example\\r\\n/admit", "multiple-lines", "nul-byte"} {
		require.Contains(t, callbackSecretTest, rejected)
	}
	callbackSecret := readRepositoryFile(t, "deploy/swarm/scripts/callback-secret.sh")
	require.Contains(t, callbackSecret, "dd if=")
	require.Contains(t, callbackSecret, "docker secret create --label")
}
