#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
RUNNER="${ROOT_DIR}/deploy/swarm/scripts/deploy.sh"
FAKE_BIN="${ROOT_DIR}/deploy/swarm/scripts/testdata"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "${TEST_ROOT}"' EXIT

DIGEST="sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
AUTH_IMAGE="registry.example.test/auth-master@${DIGEST}"
POSTGRES_IMAGE="registry.example.test/postgres@${DIGEST}"
BACKEND_IMAGE="registry.example.test/furan-backend@${DIGEST}"

fail() {
  echo "deploy preflight test failed: $*" >&2
  exit 1
}

run_case() {
  local name="$1"
  local configured_backend="${2-}"
  local configured_auth="${3-${AUTH_IMAGE}}"
  local configured_postgres="${4-${POSTGRES_IMAGE}}"
  CASE_DIR="${TEST_ROOT}/${name}"
  mkdir -p "${CASE_DIR}"
  cat >"${CASE_DIR}/production.conf" <<CONFIG
STACK_NAME=furanocoumarins
PUBLIC_APP_ORIGIN=https://front.example.test
AUTH_MASTER_IMAGE=${configured_auth}
FURANO_IMPORT_IMAGE=registry.example.test/import@${DIGEST}
FURANO_BACKEND_IMAGE=${configured_backend}
AUTH_POSTGRES_IMAGE=${configured_postgres}
AUTH_SMTP_HOST=smtp.example.test
AUTH_SMTP_PORT=587
AUTH_MAIL_FROM=auth@example.test
AUTH_SMTP_USER=auth@example.test
FURANO_SUPERUSER=admin@example.test
CONFIG
  set +e
  PATH="${FAKE_BIN}:${PATH}" \
    FAKE_DOCKER_STATE="${CASE_DIR}" FAKE_SCENARIO="success" FAKE_DEPLOYED_IMAGE="${BACKEND_IMAGE}" \
    "${RUNNER}" --config "${CASE_DIR}/production.conf" >"${CASE_DIR}/output" 2>&1
  CASE_STATUS=$?
  set -e
}

assert_image_preflight_failure() {
  local explanation="$1"
  [[ "${CASE_STATUS}" -ne 0 ]] || fail "expected image-reference preflight failure"
  grep -Fq "${explanation}" "${CASE_DIR}/output" ||
    fail "missing image-reference preflight explanation"
  [[ ! -e "${CASE_DIR}/calls" ]] || fail "image-reference preflight contacted Docker"
}

run_case missing ""
assert_image_preflight_failure "FURANO_BACKEND_IMAGE must be set"

run_case backend-latest "registry.example.test/furan-backend:latest"
assert_image_preflight_failure "FURANO_BACKEND_IMAGE must use a pinned digest or explicit non-latest version tag"

run_case auth-latest "${BACKEND_IMAGE}" "registry.example.test/auth-master:latest"
assert_image_preflight_failure "AUTH_MASTER_IMAGE must use a pinned digest or explicit non-latest version tag"

run_case postgres-latest "${BACKEND_IMAGE}" "${AUTH_IMAGE}" "postgres:latest"
assert_image_preflight_failure "AUTH_POSTGRES_IMAGE must use a pinned digest or explicit non-latest version tag"

run_case valid-digests "${BACKEND_IMAGE}"
[[ "${CASE_STATUS}" -ne 0 ]] || fail "fake Docker should stop a valid preflight before deployment"
if grep -Fq "must use a pinned digest" "${CASE_DIR}/output"; then
  fail "valid digest image was rejected"
fi
grep -Fq "info --format" "${CASE_DIR}/calls" || fail "valid preflight did not reach Docker"

run_case valid-version-tags \
  "registry.example.test/furan-backend:v2.4.1" \
  "registry.example.test/auth-master:v1.8.0" \
  "postgres:17.6"
[[ "${CASE_STATUS}" -ne 0 ]] || fail "fake Docker should stop a valid tagged preflight before deployment"
if grep -Fq "must use a pinned digest" "${CASE_DIR}/output"; then
  fail "valid non-latest version tag was rejected"
fi
grep -Fq "info --format" "${CASE_DIR}/calls" || fail "tagged preflight did not reach Docker"

echo "deploy pinned-image preflight tests passed"
