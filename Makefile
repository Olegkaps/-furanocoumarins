.PHONY: test install install-e2e frontend-deps auth-import test-unit test-race test-integration test-e2e test-e2e-proxy-debug test-backend-container test-frontend-container lint compose-check

CONTAINER_ENGINE ?= $(shell if command -v podman >/dev/null 2>&1; then echo podman; else echo docker; fi)
COMPOSE ?= $(shell if command -v podman >/dev/null 2>&1; then echo podman compose; else echo docker compose; fi)

install: frontend-deps install-e2e

frontend-deps:
	cd frontend && if [ ! -x node_modules/.bin/vite ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then npm ci --no-audit; fi

install-e2e: frontend-deps
	cd frontend && ./node_modules/.bin/playwright install chromium

# Initialize the auth schema, quiesce both writers, run the side-owned one-shot
# importer, and restore services even when the import fails. Supply source and
# selector directly through FURANO_SOURCE_DATABASE_URL and FURANO_SUPERUSER.
# The importer binary also supports *_FILE; Swarm mounts those file paths.
auth-import:
	@set -eu; \
	$(COMPOSE) -f docker-compose.local.yaml up -d auth-postgres postgres mailpit authd; \
	for _ in $$(seq 1 60); do $(COMPOSE) -f docker-compose.local.yaml exec -T authd /healthcheck >/dev/null 2>&1 && break; sleep 1; done; \
	$(COMPOSE) -f docker-compose.local.yaml exec -T authd /healthcheck >/dev/null; \
	restore() { $(COMPOSE) -f docker-compose.local.yaml up -d authd go-auth >/dev/null; }; \
	trap restore EXIT; \
	$(COMPOSE) -f docker-compose.local.yaml stop go-auth authd; \
	$(COMPOSE) -f docker-compose.local.yaml --profile migration run --rm --no-deps auth-import

test: compose-check lint test-unit test-race test-integration test-e2e test-frontend-container test-monitoring-config test-monitoring-smoke

lint: frontend-deps
	cd backend/admin && go vet ./...
	cd frontend && npm run lint

test-unit: frontend-deps
	bash deploy/swarm/scripts/production-config_test.sh
	bash deploy/swarm/scripts/image-reference_test.sh
	bash deploy/swarm/scripts/init-secrets_test.sh
	./deploy/swarm/scripts/callback-url_test.sh
	./deploy/swarm/scripts/callback-secret_test.sh
	./deploy/swarm/scripts/deploy_test.sh
	./deploy/swarm/scripts/run-auth-import_test.sh
	cd backend/admin && ENV_TYPE=TEST go test ./... -count=1
	cd frontend && npm run test:unit
	cd frontend && npm run build

test-race: frontend-deps
	cd backend/admin && ENV_TYPE=TEST go test -race ./... -count=1

test-backend-container:
	$(COMPOSE) -f docker-compose.test.yaml run --rm --build test

# Uses disposable databases only: migration fixtures create chemdb tables/data.
# Provision them separately; this target never mounts or deletes legacy volumes.
.PHONY: test-entity-migration
test-entity-migration:
	@test -n "$(TEST_POSTGRES_DSN)" || { echo 'TEST_POSTGRES_DSN must select a disposable test database'; exit 1; }
	@test -n "$(TEST_CASSANDRA_HOST)" || { echo 'TEST_CASSANDRA_HOST must select a disposable Cassandra fixture'; exit 1; }
	cd backend/admin && ENV_TYPE=TEST go test -tags=integration -p 1 ./internal/application/create ./internal/infrastructure/persistence/cassandra ./internal/migration/cassandrapostgres -count=1

# PostgreSQL-only metadata versioning, backfill, and HTTP persistence checks.
.PHONY: test-metadata
test-metadata:
	@test -n "$(TEST_POSTGRES_DSN)" || { echo 'TEST_POSTGRES_DSN must select a disposable test database'; exit 1; }
	cd backend/admin && ENV_TYPE=TEST go test -tags=integration -p 1 ./internal/pkg/metadata ./internal/application/create ./internal/infrastructure/persistence/cassandra ./internal/presentation/http/create -run 'Metadata|Document' -count=1

test-frontend-container:
	@set -eu; \
	image=furanocoumarins-frontend-test:local; \
	name=furanocoumarins-frontend-test-$$$$; \
	cleanup() { $(CONTAINER_ENGINE) rm -f "$$name" >/dev/null 2>&1 || true; }; \
	trap cleanup EXIT; \
	$(CONTAINER_ENGINE) build -t "$$image" ./frontend; \
	$(CONTAINER_ENGINE) run -d --user 65532:65532 --name "$$name" "$$image" >/dev/null; \
	for _ in $$(seq 1 20); do \
		$(CONTAINER_ENGINE) exec "$$name" wget -qO- http://127.0.0.1:8080/ >/dev/null 2>&1 && exit 0; \
		sleep 1; \
	done; \
	$(CONTAINER_ENGINE) logs "$$name" >&2; \
	exit 1

# The browser journey is also the real-service integration gate: it provisions
# source/target PostgreSQL, runs the offline importer, starts private authd and
# Mailpit, then drives the BFF. Expressing this as a dependency lets `make test`
# execute the expensive stack exactly once.
test-integration: test-e2e

test-e2e: frontend-deps
	./scripts/auth-e2e.sh

test-e2e-proxy-debug: frontend-deps
	E2E_PROJECT_NAME=furano-auth-proxy-debug-$$$$ E2E_SAFE_CLEANUP=1 E2E_FRONTEND=proxy E2E_FRONTEND_ORIGIN=http://localhost:5174 E2E_DEBUG_AUTH=1 E2E_AUTH_ONLY=1 E2E_TEST_GREP='passwordless migrated superuser' ./scripts/auth-e2e.sh

compose-check:
	$(COMPOSE) -f docker-compose.local.yaml --profile migration config
	$(COMPOSE) -f docker-compose.auth-test.yaml config
	AUTH_MASTER_IMAGE='registry.invalid/auth-master@sha256:0000000000000000000000000000000000000000000000000000000000000000' \
	FURANO_IMPORT_IMAGE='registry.invalid/furan-import@sha256:1111111111111111111111111111111111111111111111111111111111111111' \
	FURANO_BACKEND_IMAGE='registry.invalid/furan-backend@sha256:2222222222222222222222222222222222222222222222222222222222222222' \
	AUTH_POSTGRES_IMAGE='postgres@sha256:0000000000000000000000000000000000000000000000000000000000000000' \
	AUTH_SMTP_HOST='smtp.invalid' AUTH_MAIL_FROM='auth@invalid' \
	FURANO_REPOSITORY_ROOT='$(CURDIR)' \
	$(COMPOSE) -f deploy/swarm/stack.yaml config
	@bash -n deploy/swarm/scripts/production-config.sh deploy/swarm/scripts/production-config_test.sh deploy/swarm/scripts/callback-url.sh deploy/swarm/scripts/callback-url_test.sh deploy/swarm/scripts/callback-secret.sh deploy/swarm/scripts/callback-secret_test.sh deploy/swarm/scripts/image-reference.sh deploy/swarm/scripts/image-reference_test.sh deploy/swarm/scripts/deploy.sh deploy/swarm/scripts/deploy_test.sh deploy/swarm/scripts/init-secrets.sh deploy/swarm/scripts/init-secrets_test.sh deploy/swarm/scripts/run-auth-import.sh deploy/swarm/scripts/run-auth-import_test.sh deploy/swarm/scripts/testdata/docker
	@test ! -e docker-compose.yaml || { echo 'obsolete docker-compose.yaml must remain deleted'; exit 1; }

# Monitoring validation is isolated from deployed services and volumes.
.PHONY: test-monitoring test-monitoring-config test-monitoring-backend test-monitoring-smoke
MONITORING_TEST_COMPOSE = $(COMPOSE) -p furano-monitoring-validation -f monitoring/compose.test.yaml

test-monitoring-backend:
	cd backend/admin && ENV_TYPE=TEST go test ./internal/presentation/http/... -count=1

test-monitoring-config:
	python3 scripts/monitoring-check.py
	$(MONITORING_TEST_COMPOSE) run --rm --no-deps --entrypoint promtool prometheus check config /etc/prometheus/prometheus.yml
	$(MONITORING_TEST_COMPOSE) run --rm --no-deps --entrypoint promtool prometheus test rules /etc/prometheus/tests/alerts.test.yml
	$(MONITORING_TEST_COMPOSE) run --rm --no-deps nginxlog -config-file /etc/nginxlog.yml -verify-config
	$(MONITORING_TEST_COMPOSE) run --rm --no-deps --entrypoint amtool alertmanager check-config /etc/alertmanager/alertmanager.yml
	@echo 'PASS: monitoring contracts, Prometheus alert tests and exporter configuration'

test-monitoring: test-monitoring-backend test-monitoring-config

# Runs a temporary stack with synthetic metrics and no production resources.
test-monitoring-smoke:
	COMPOSE='$(COMPOSE)' bash scripts/monitoring-smoke.sh
