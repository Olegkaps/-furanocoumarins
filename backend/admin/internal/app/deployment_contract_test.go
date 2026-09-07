package app_test

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

func repositoryRoot(t *testing.T) string {
	t.Helper()
	if configured := os.Getenv("FURANO_REPOSITORY_ROOT"); configured != "" {
		root, err := filepath.Abs(configured)
		require.NoError(t, err)
		_, err = os.Stat(filepath.Join(root, "backend", "admin", "go.mod"))
		require.NoError(t, err, "FURANO_REPOSITORY_ROOT must point to the repository checkout")
		return root
	}
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

func TestCIUsesModuleGoVersionAndMountsRepositoryContracts(t *testing.T) {
	workflow := readRepositoryFile(t, ".github/workflows/backed-go.yml")
	require.NotContains(t, workflow, "go-version: stable", "stable can outrun the Go version used to build golangci-lint")
	require.GreaterOrEqual(t, strings.Count(workflow, "go-version-file: backend/admin/go.mod"), 2)
	require.Contains(t, workflow, "cache-dependency-path: backend/admin/go.sum")
	require.Contains(t, workflow, "make test-backend-container COMPOSE='docker compose'")
	require.Contains(t, workflow, "args: --config=.golangci.yml")

	compose := readRepositoryFile(t, "docker-compose.test.yaml")
	require.Contains(t, compose, "FURANO_REPOSITORY_ROOT: /workspace")
	require.Contains(t, compose, ".:/workspace:ro")
}

func TestGolangCILintExcludesOnlyDeferredCloseCallsFromErrcheck(t *testing.T) {
	var config struct {
		Version string `yaml:"version"`
		Linters struct {
			Exclusions struct {
				Rules []struct {
					Linters []string `yaml:"linters"`
					Source  string   `yaml:"source"`
				} `yaml:"rules"`
			} `yaml:"exclusions"`
		} `yaml:"linters"`
	}
	require.NoError(t, yaml.Unmarshal([]byte(readRepositoryFile(t, "backend/admin/.golangci.yml")), &config))
	require.Equal(t, "2", config.Version)
	require.Len(t, config.Linters.Exclusions.Rules, 1)
	rule := config.Linters.Exclusions.Rules[0]
	require.Equal(t, []string{"errcheck"}, rule.Linters)
	require.Equal(t, `^\s*defer\s+.+\.Close\(\)\s*(?://.*|/\*.*)?\s*$`, rule.Source)

	pattern := regexp.MustCompile(rule.Source)
	require.True(t, pattern.MatchString("\tdefer resp.Body.Close()"))
	require.True(t, pattern.MatchString("defer conn.Close()"))
	require.True(t, pattern.MatchString("defer conn.Close() // cleanup"))
	require.True(t, pattern.MatchString("defer getCloser().Close() /* cleanup */"))
	require.True(t, pattern.MatchString("defer conn.Close() /* cleanup starts"), "golangci source matching sees only the first physical line of a block comment")
	require.False(t, pattern.MatchString("resp.Body.Close()"), "direct Close calls must remain checked")
	require.False(t, pattern.MatchString("defer fmt.Fprint(w, body)"), "other deferred results must remain checked")
	require.False(t, pattern.MatchString("defer close(done)"), "only method Close calls are exempt")
	require.False(t, pattern.MatchString("defer conn.Close(); report()"), "a trailing statement must remain checked")
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
			DependsOn   []string          `yaml:"depends_on"`
			Healthcheck map[string]any    `yaml:"healthcheck"`
			Deploy      map[string]any    `yaml:"deploy"`
			Volumes     []string          `yaml:"volumes"`
		} `yaml:"services"`
		Secrets map[string]any `yaml:"secrets"`
		Volumes map[string]struct {
			External bool   `yaml:"external"`
			Name     string `yaml:"name"`
		} `yaml:"volumes"`
	}
	stackYAML := readRepositoryFile(t, "deploy/swarm/stack.yaml")
	require.NotContains(t, stackYAML, ":?", "docker stack deploy does not support required-value Compose interpolation")
	require.NoError(t, yaml.Unmarshal([]byte(stackYAML), &stack))

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
	require.ElementsMatch(t, []string{"postgres"}, stack.Services["postgres-exporter"].DependsOn)
	require.ElementsMatch(t, []string{"redis"}, stack.Services["redis-exporter"].DependsOn)
	require.ElementsMatch(t, []string{"cassandra"}, stack.Services["cassandra-exporter"].DependsOn)
	require.ElementsMatch(t, []string{"go-auth", "grafana"}, stack.Services["nginx"].DependsOn)
	require.ElementsMatch(t, []string{"nginx"}, stack.Services["nginx-exporter"].DependsOn)
	require.ElementsMatch(t, []string{"prometheus"}, stack.Services["grafana"].DependsOn)
	require.ElementsMatch(t, []string{"loki"}, stack.Services["promtail"].DependsOn)
	require.Contains(t, goAuth.Networks, "metrics")
	require.Contains(t, stack.Services["nginx"].Networks, "metrics")
	require.Contains(t, stack.Services["nginx"].Volumes, "./configs/nginx.conf:/etc/nginx/conf.d/default.conf:ro")
	require.Contains(t, stack.Services["nginx"].Volumes, "../../monitoring/nginx-metrics.conf:/etc/nginx/monitoring/nginx-metrics.conf:ro")
	require.NotContains(t, stackYAML, "./deploy/swarm/", "bind paths are resolved relative to deploy/swarm/stack.yaml")
	require.NotContains(t, stackYAML, "- ./monitoring/", "repository monitoring files are two directories above stack.yaml")
	nginxConfig := readRepositoryFile(t, "deploy/swarm/configs/nginx.conf")
	require.Contains(t, nginxConfig, "resolver 127.0.0.11")
	require.Contains(t, nginxConfig, "set $backend_upstream http://go-auth:80")
	require.Contains(t, nginxConfig, "error_log /dev/stderr")

	for _, secret := range []string{
		"auth_database_url",
		"auth_password_history_key", "auth_signing_key", "auth_magic_callback_url",
		"auth_invite_callback_url",
	} {
		require.Contains(t, stack.Secrets, secret)
	}
	require.NotContains(t, stack.Secrets, "auth_source_database_url", "migration source must not be attached to the persistent stack")
	require.NotContains(t, stack.Secrets, "auth_selected_superuser", "migration identity must not be attached to the persistent stack")

	cassandra := stack.Services["cassandra"]
	require.Equal(t, "cassandra:3.11.9", cassandra.Image)
	require.Equal(t, "1024M", cassandra.Environment["MAX_HEAP_SIZE"])
	require.Equal(t, "200M", cassandra.Environment["HEAP_NEWSIZE"])
	require.Equal(t, map[string]any{
		"limits": map[string]any{"cpus": "0.50", "memory": "2G"},
	}, cassandra.Deploy["resources"])
	require.Contains(t, cassandra.Volumes, "cassandra3_data:/var/lib/cassandra")
	cassandraVolume, ok := stack.Volumes["cassandra3_data"]
	require.True(t, ok)
	require.True(t, cassandraVolume.External, "Swarm must mount only the explicitly prepared Cassandra target")
	require.Contains(t, cassandraVolume.Name, "SWARM_CASSANDRA_VOLUME")
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
		"FURANO_IMPORT_IMAGE", "image-reference.sh", "require_pinned_image_reference FURANO_IMPORT_IMAGE", "auth_source_database_url",
		"LEGACY_POSTGRES_CONTAINER_ID", "auth-import-network", "legacy-postgres", "docker network connect",
		"auth_database_url", "auth_selected_superuser", "FURANO_SOURCE_DATABASE_URL_FILE",
		"DATABASE_URL_FILE", "FURANO_SUPERUSER_FILE", "--restart-condition none",
		`"${FURANO_IMPORT_IMAGE}"`, `"${GO_AUTH_SERVICE}=0"`,
		`"${AUTHD_SERVICE}=0"`, "CurrentState",
		"New|Pending|Assigned|Accepted|Preparing|Ready|Starting|Running", "restore_services",
		"docker service logs --raw --follow", "Importer task state:", "IMPORT_LOG_PID",
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
	productionConfig := readRepositoryFile(t, "deploy/swarm/scripts/production-config.sh")
	productionExample := readRepositoryFile(t, "deploy/swarm/production.conf.example")
	swarmReadme := readRepositoryFile(t, "deploy/swarm/README.md")
	rootReadme := readRepositoryFile(t, "README.md")
	deploy := readRepositoryFile(t, "deploy/swarm/scripts/deploy.sh")
	cassandraMigration := readRepositoryFile(t, "deploy/swarm/scripts/migrate-cassandra-volume.sh")
	for _, script := range []string{initSecrets, deploy, cassandraMigration, readRepositoryFile(t, "deploy/swarm/scripts/run-auth-import.sh")} {
		require.Contains(t, script, "production-config.sh")
		require.Contains(t, script, "load_production_config")
	}
	for _, required := range []string{
		"PUBLIC_APP_ORIGIN", "AUTH_MASTER_IMAGE", "FURANO_IMPORT_IMAGE",
		"FURANO_BACKEND_IMAGE", "AUTH_POSTGRES_IMAGE", "FURANO_SUPERUSER",
	} {
		require.Contains(t, productionConfig, required)
		require.Contains(t, productionExample, required)
	}
	for _, removed := range []string{
		"AUTH_DATABASE_URL_FILE", "FURANO_SOURCE_DATABASE_URL_FILE", "FURANO_SUPERUSER_FILE",
		"AUTH_MAGIC_CALLBACK_URL_FILE", "AUTH_INVITE_CALLBACK_URL_FILE",
	} {
		require.NotContains(t, initSecrets, removed)
	}
	for _, command := range []string{
		"docker swarm init", "cp deploy/swarm/production.conf.example deploy/swarm/production.conf",
		"./deploy/swarm/scripts/init-secrets.sh", "./deploy/swarm/scripts/migrate-cassandra-volume.sh",
		"./deploy/swarm/scripts/deploy.sh",
		"./deploy/swarm/scripts/run-auth-import.sh",
	} {
		require.Contains(t, swarmReadme, command)
		require.Contains(t, rootReadme, command)
	}
	require.NotContains(t, swarmReadme, "export AUTH_MASTER_IMAGE")
	require.NotContains(t, swarmReadme, "AUTH_MAGIC_CALLBACK_URL_FILE")
	require.NotContains(t, swarmReadme, "AUTH_INVITE_CALLBACK_URL_FILE")
	gitignore := readRepositoryFile(t, ".gitignore")
	require.Contains(t, gitignore, "deploy/swarm/production.conf")
	require.Contains(t, deploy, "require_pinned_image_reference AUTH_MASTER_IMAGE")
	require.Contains(t, deploy, "require_pinned_image_reference AUTH_POSTGRES_IMAGE")
	require.Contains(t, deploy, "require_pinned_image_reference FURANO_BACKEND_IMAGE")
	require.Contains(t, productionExample, "auth-master:v1.2.3")
	require.Contains(t, productionExample, "furan-import:v1.2.3")
	require.Contains(t, productionExample, "furan-backend:v1.2.3")
	require.Contains(t, productionExample, "postgres:17.6")
	require.Contains(t, swarmReadme, "explicit non-`latest` version tag")
	require.NotContains(t, deploy, "auth_source_database_url")
	require.NotContains(t, deploy, "auth_selected_superuser")
	require.Contains(t, deploy, "validate_callback_secret auth_magic_callback_url /admit")
	require.Contains(t, deploy, "validate_callback_secret auth_invite_callback_url /register")
	require.NotContains(t, deploy, "curl ", "deploy preflight must not probe callback URLs through external balancers")
	require.NotContains(t, deploy, "External BrowserRouter callback")
	require.Contains(t, initSecrets, `MAGIC_CALLBACK_URL="${PUBLIC_APP_ORIGIN}/admit"`)
	require.Contains(t, initSecrets, `INVITE_CALLBACK_URL="${PUBLIC_APP_ORIGIN}/register"`)
	require.Contains(t, initSecrets, "create_normalized_callback_secret auth_magic_callback_url")
	require.Contains(t, initSecrets, "create_normalized_callback_secret auth_invite_callback_url")
	require.Contains(t, initSecrets, "validate_spa_origin_contract")
	require.Contains(t, initSecrets, "furanocoumarins.allow-origin")
	require.Contains(t, initSecrets, "openssl rand -hex")
	require.Contains(t, initSecrets, "@postgres:5432/")
	require.Contains(t, deploy, "validate_go_auth_origin")
	require.Contains(t, deploy, "wait_for_local_service_health")
	require.Contains(t, deploy, "prepare_cassandra_volume")
	require.Contains(t, deploy, "--fresh-cassandra")
	require.Contains(t, deploy, "furanocoumarins.cassandra-volume")
	require.Contains(t, deploy, ".furanocoumarins-cassandra-migration-v1")
	require.Contains(t, deploy, `"${STACK_NAME}_authd"`)
	require.Contains(t, deploy, `"${STACK_NAME}_go-auth"`)
	for _, required := range []string{
		"nodetool drain", "tar --numeric-owner", "sha256sum", "cmp -s",
		"docker volume rm", "docker start", "cassandra:3.11.9",
		"furanocoumarins.cassandra-source",
		".furanocoumarins-cassandra-migration-v1",
	} {
		require.Contains(t, cassandraMigration, required)
	}
	require.NotContains(t, cassandraMigration, "docker-compose.local.yaml")
	require.NotContains(t, cassandraMigration, "docker compose")
	require.Less(t, strings.Index(cassandraMigration, "nodetool drain"), strings.Index(cassandraMigration, "tar --numeric-owner"))
	require.Contains(t, productionConfig, "LEGACY_CASSANDRA_VOLUME")
	require.Contains(t, productionConfig, "SWARM_CASSANDRA_VOLUME")
	require.Contains(t, productionExample, "LEGACY_CASSANDRA_VOLUME")
	require.Contains(t, productionExample, "SWARM_CASSANDRA_VOLUME")

	makefile := readRepositoryFile(t, "Makefile")
	require.Contains(t, makefile, "test: compose-check")
	require.Contains(t, makefile, "deploy/swarm/stack.yaml config")
	require.Contains(t, makefile, "FURANO_IMPORT_IMAGE")
	require.Contains(t, makefile, "FURANO_BACKEND_IMAGE")
	require.True(t, strings.Contains(makefile, "bash -n deploy/swarm/scripts"))
	require.Contains(t, makefile, "./deploy/swarm/scripts/callback-url_test.sh")
	require.Contains(t, makefile, "./deploy/swarm/scripts/callback-secret_test.sh")
	require.Contains(t, makefile, "deploy/swarm/scripts/production-config_test.sh")
	require.Contains(t, makefile, "deploy/swarm/scripts/init-secrets_test.sh")
	require.Contains(t, makefile, "deploy/swarm/scripts/migrate-cassandra-volume_test.sh")
	require.Contains(t, makefile, "test-backend-container:")

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
