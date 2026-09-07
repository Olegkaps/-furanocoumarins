#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
source "${ROOT_DIR}/deploy/swarm/scripts/production-config.sh"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "${TEST_DIR}"' EXIT

fail() {
  echo "production config test failed: $*" >&2
  exit 1
}

write_valid() {
  local file="$1"
  cat >"${file}" <<'CONFIG'
PUBLIC_APP_ORIGIN=https://front.example.test
AUTH_MASTER_IMAGE=registry.example.test/auth@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
FURANO_IMPORT_IMAGE=registry.example.test/import@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
FURANO_BACKEND_IMAGE=registry.example.test/backend@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
AUTH_POSTGRES_IMAGE=postgres@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
AUTH_SMTP_HOST=smtp.example.test
AUTH_MAIL_FROM=auth@example.test
FURANO_SUPERUSER=Admin@Example.Test
LEGACY_POSTGRES_CONTAINER_ID=0123456789ab
CONFIG
}

write_valid "${TEST_DIR}/valid.conf"
AUTH_MASTER_IMAGE=must-not-leak-from-environment
load_production_config "${TEST_DIR}/valid.conf"
[[ "${PUBLIC_APP_ORIGIN}" == "https://front.example.test" ]] || fail "origin was not loaded"
[[ "${STACK_NAME}" == "furanocoumarins" ]] || fail "default stack name was not applied"
[[ "${AUTH_SMTP_PORT}" == "587" ]] || fail "default SMTP port was not applied"
[[ -z "${AUTH_SMTP_USER}" ]] || fail "optional SMTP user was not empty"
[[ "${LEGACY_CASSANDRA_VOLUME}" == "furanocoumarins_cassandra3_data" ]] || fail "legacy Cassandra volume default changed"
[[ "${SWARM_CASSANDRA_VOLUME}" == "furanocoumarins_swarm_cassandra3_data" ]] || fail "Swarm Cassandra volume default changed"
[[ "${AUTH_MASTER_IMAGE}" == registry.example.test/auth@sha256:* ]] || fail "environment overrode the file"
[[ "${FURANO_SUPERUSER}" == "Admin@Example.Test" ]] || fail "selector casing changed"
[[ "${LEGACY_POSTGRES_CONTAINER_ID}" == "0123456789ab" ]] || fail "legacy PostgreSQL container ID was not loaded"

cp "${TEST_DIR}/valid.conf" "${TEST_DIR}/unknown.conf"
printf 'SURPRISE=value\n' >>"${TEST_DIR}/unknown.conf"
if (load_production_config "${TEST_DIR}/unknown.conf") >/dev/null 2>&1; then
  fail "unknown setting was accepted"
fi

cp "${TEST_DIR}/valid.conf" "${TEST_DIR}/quoted.conf"
sed -i.bak 's|PUBLIC_APP_ORIGIN=https://front.example.test|PUBLIC_APP_ORIGIN="https://front.example.test"|' "${TEST_DIR}/quoted.conf"
if (load_production_config "${TEST_DIR}/quoted.conf") >/dev/null 2>&1; then
  fail "quoted shell value was accepted"
fi

cp "${TEST_DIR}/valid.conf" "${TEST_DIR}/same-volume.conf"
printf 'LEGACY_CASSANDRA_VOLUME=shared\nSWARM_CASSANDRA_VOLUME=shared\n' >>"${TEST_DIR}/same-volume.conf"
if (load_production_config "${TEST_DIR}/same-volume.conf") >/dev/null 2>&1; then
  fail "identical source and target Cassandra volumes were accepted"
fi

echo "production config tests passed"
