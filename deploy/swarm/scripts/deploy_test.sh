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
  CASE_DIR="${TEST_ROOT}/${name}"
  mkdir -p "${CASE_DIR}"
  cat >"${CASE_DIR}/production.conf" <<CONFIG
STACK_NAME=furanocoumarins
PUBLIC_APP_ORIGIN=https://front.example.test
AUTH_MASTER_IMAGE=${AUTH_IMAGE}
FURANO_IMPORT_IMAGE=registry.example.test/import@${DIGEST}
FURANO_BACKEND_IMAGE=${configured_backend}
AUTH_POSTGRES_IMAGE=${POSTGRES_IMAGE}
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

assert_backend_preflight_failure() {
  local explanation="$1"
  [[ "${CASE_STATUS}" -ne 0 ]] || fail "expected immutable backend image failure"
  grep -Fq "${explanation}" "${CASE_DIR}/output" ||
    fail "missing immutable backend image explanation"
  [[ ! -e "${CASE_DIR}/calls" ]] || fail "backend image preflight contacted Docker"
}

run_case missing ""
assert_backend_preflight_failure "FURANO_BACKEND_IMAGE must be set"

run_case mutable "registry.example.test/furan-backend:latest"
assert_backend_preflight_failure "FURANO_BACKEND_IMAGE must be set to an immutable image digest"

run_case valid "${BACKEND_IMAGE}"
[[ "${CASE_STATUS}" -ne 0 ]] || fail "fake Docker should stop a valid preflight before deployment"
if grep -Fq "FURANO_BACKEND_IMAGE must be set" "${CASE_DIR}/output"; then
  fail "valid immutable backend image was rejected"
fi
grep -Fq "info --format" "${CASE_DIR}/calls" || fail "valid preflight did not reach Docker"

echo "deploy immutable-image preflight tests passed"
