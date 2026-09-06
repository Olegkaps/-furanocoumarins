#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
RUNNER="${ROOT_DIR}/deploy/swarm/scripts/init-secrets.sh"
FAKE_BIN="${ROOT_DIR}/deploy/swarm/scripts/testdata"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "${TEST_DIR}"' EXIT

fail() {
  echo "init-secrets test failed: $*" >&2
  exit 1
}

mkdir -p "${TEST_DIR}/env" "${TEST_DIR}/state"
cat >"${TEST_DIR}/production.conf" <<'CONFIG'
STACK_NAME=furanocoumarins
PUBLIC_APP_ORIGIN=https://front.example.test
AUTH_MASTER_IMAGE=registry.example.test/auth@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
FURANO_IMPORT_IMAGE=registry.example.test/import@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
FURANO_BACKEND_IMAGE=registry.example.test/backend@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
AUTH_POSTGRES_IMAGE=postgres@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
AUTH_SMTP_HOST=smtp.example.test
AUTH_SMTP_PORT=587
AUTH_MAIL_FROM=auth@example.test
AUTH_SMTP_USER=mailer@example.test
FURANO_SUPERUSER=Admin@Example.Test
CONFIG
cat >"${TEST_DIR}/env/.env" <<'ENV'
ALLOW_ORIGIN="*"
DOMAIN_PREF="http://localhost:5173"
ENV_TYPE="DEV"
MAIL="legacy@example.test"
MAIL_SECRET="smtp password"
ENV
cat >"${TEST_DIR}/env/postgres.env" <<'ENV'
POSTGRES_USER="legacy user"
POSTGRES_PASSWORD="p@ss word"
POSTGRES_DB="legacy/db"
ENV
cat >"${TEST_DIR}/env/redis.env" <<'ENV'
REDIS_PASSWORD="redis password"
ENV

run_initializer() {
  PATH="${FAKE_BIN}:${PATH}" FAKE_DOCKER_STATE="${TEST_DIR}/state" FAKE_SCENARIO=init-secrets \
    bash "${RUNNER}" --config "${TEST_DIR}/production.conf" --env-dir "${TEST_DIR}/env"
}

run_initializer >"${TEST_DIR}/first-output"
[[ "$(<"${TEST_DIR}/state/secret-auth_magic_callback_url")" == "https://front.example.test/admit" ]] || fail "magic callback was not derived"
[[ "$(<"${TEST_DIR}/state/secret-auth_invite_callback_url")" == "https://front.example.test/register" ]] || fail "invite callback was not derived"
[[ "$(<"${TEST_DIR}/state/secret-auth_selected_superuser")" == "Admin@Example.Test" ]] || fail "superuser was not read from config"
grep -Fq 'ALLOW_ORIGIN="https://front.example.test"' "${TEST_DIR}/state/secret-go_auth_env" || fail "production origin missing"
grep -Fq 'DOMAIN_PREF="https://front.example.test"' "${TEST_DIR}/state/secret-go_auth_env" || fail "production domain missing"
grep -Fq 'ENV_TYPE="PROD"' "${TEST_DIR}/state/secret-go_auth_env" || fail "production mode missing"
[[ "$(<"${TEST_DIR}/state/secret-auth_smtp_password")" == "smtp password" ]] || fail "SMTP password was not taken from env/.env"
[[ "$(<"${TEST_DIR}/state/secret-auth_source_database_url")" == "postgres://legacy%20user:p%40ss%20word@postgres:5432/legacy%2Fdb?sslmode=disable" ]] || fail "source DSN was not safely derived"
grep -Eq '^postgres://auth_master:[0-9a-f]{48}@auth-postgres:5432/auth_master\?sslmode=disable$' "${TEST_DIR}/state/secret-auth_database_url" || fail "auth DSN was not generated"
if grep -Eq 'AUTH_(MAGIC|INVITE)_CALLBACK_URL_FILE|must be readable' "${TEST_DIR}/first-output"; then
  fail "initializer still asks for callback files"
fi

before="$(grep -c '^secret create' "${TEST_DIR}/state/calls")"
run_initializer >"${TEST_DIR}/second-output"
after="$(grep -c '^secret create' "${TEST_DIR}/state/calls")"
[[ "${before}" == "${after}" ]] || fail "idempotent rerun recreated secrets"

echo "init-secrets fresh-operator tests passed"
