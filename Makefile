.PHONY: test install install-e2e frontend-deps auth-import test-unit test-race test-integration test-e2e test-backend-container lint compose-check

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

test: compose-check lint test-unit test-race test-integration test-e2e

lint: frontend-deps
	cd backend/admin && go vet ./...
	cd frontend && npm run lint

test-unit: frontend-deps
	bash deploy/swarm/scripts/production-config_test.sh
	bash deploy/swarm/scripts/init-secrets_test.sh
	bash deploy/swarm/scripts/migrate-cassandra-volume_test.sh
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

# The browser journey is also the real-service integration gate: it provisions
# source/target PostgreSQL, runs the offline importer, starts private authd and
# Mailpit, then drives the BFF. Expressing this as a dependency lets `make test`
# execute the expensive stack exactly once.
test-integration: test-e2e

test-e2e: frontend-deps
	./scripts/auth-e2e.sh

compose-check:
	$(COMPOSE) -f docker-compose.local.yaml --profile migration config
	$(COMPOSE) -f docker-compose.auth-test.yaml config
	AUTH_MASTER_IMAGE='registry.invalid/auth-master@sha256:0000000000000000000000000000000000000000000000000000000000000000' \
	FURANO_IMPORT_IMAGE='registry.invalid/furan-import@sha256:1111111111111111111111111111111111111111111111111111111111111111' \
	FURANO_BACKEND_IMAGE='registry.invalid/furan-backend@sha256:2222222222222222222222222222222222222222222222222222222222222222' \
	AUTH_POSTGRES_IMAGE='postgres@sha256:0000000000000000000000000000000000000000000000000000000000000000' \
	AUTH_SMTP_HOST='smtp.invalid' AUTH_MAIL_FROM='auth@invalid' \
	$(COMPOSE) -f deploy/swarm/stack.yaml config
	@bash -n deploy/swarm/scripts/production-config.sh deploy/swarm/scripts/production-config_test.sh deploy/swarm/scripts/callback-url.sh deploy/swarm/scripts/callback-url_test.sh deploy/swarm/scripts/callback-secret.sh deploy/swarm/scripts/callback-secret_test.sh deploy/swarm/scripts/deploy.sh deploy/swarm/scripts/deploy_test.sh deploy/swarm/scripts/init-secrets.sh deploy/swarm/scripts/init-secrets_test.sh deploy/swarm/scripts/migrate-cassandra-volume.sh deploy/swarm/scripts/migrate-cassandra-volume_test.sh deploy/swarm/scripts/run-auth-import.sh deploy/swarm/scripts/run-auth-import_test.sh deploy/swarm/scripts/testdata/docker
	@test ! -e docker-compose.yaml || { echo 'obsolete docker-compose.yaml must remain deleted'; exit 1; }
