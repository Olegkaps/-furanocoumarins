#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
RUNNER="${ROOT_DIR}/deploy/swarm/scripts/run-auth-import.sh"
FAKE_BIN="${ROOT_DIR}/deploy/swarm/scripts/testdata"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "${TEST_ROOT}"' EXIT

DIGEST="sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
IMAGE="registry.example.test/furan-import@${DIGEST}"

fail() {
  echo "run-auth-import test failed: $*" >&2
  exit 1
}

run_case() {
  local name="$1"
  local scenario="$2"
  local configured_image="${3:-${IMAGE}}"
  local deployed_image="${4:-${IMAGE}}"
  CASE_DIR="${TEST_ROOT}/${name}"
  mkdir -p "${CASE_DIR}"
  cat >"${CASE_DIR}/production.conf" <<CONFIG
STACK_NAME=furanocoumarins
PUBLIC_APP_ORIGIN=https://front.example.test
AUTH_MASTER_IMAGE=registry.example.test/auth@${DIGEST}
FURANO_IMPORT_IMAGE=${configured_image}
FURANO_BACKEND_IMAGE=registry.example.test/backend@${DIGEST}
AUTH_POSTGRES_IMAGE=postgres@${DIGEST}
AUTH_SMTP_HOST=smtp.example.test
AUTH_SMTP_PORT=587
AUTH_MAIL_FROM=auth@example.test
AUTH_SMTP_USER=auth@example.test
FURANO_SUPERUSER=admin@example.test
CONFIG
  set +e
  PATH="${FAKE_BIN}:${PATH}" \
    FAKE_DOCKER_STATE="${CASE_DIR}" FAKE_SCENARIO="${scenario}" \
    FAKE_DEPLOYED_IMAGE="${deployed_image}" FAKE_GO_AUTH_REPLICAS=4 FAKE_AUTHD_REPLICAS=3 \
    FAKE_WRITER_ACTIVE_CALLS=2 \
    WRITER_STOP_ATTEMPTS=2 WRITER_STOP_INTERVAL=0 IMPORT_ATTEMPTS=2 IMPORT_INTERVAL=0 \
    "${RUNNER}" --config "${CASE_DIR}/production.conf" >"${CASE_DIR}/output" 2>&1
  CASE_STATUS=$?
  set -e
}

assert_status() {
  local want="$1"
  if [[ "${want}" == "zero" && "${CASE_STATUS}" -ne 0 ]]; then
    cat "${CASE_DIR}/output" >&2
    fail "expected success, got ${CASE_STATUS}"
  fi
  if [[ "${want}" == "nonzero" && "${CASE_STATUS}" -eq 0 ]]; then
    fail "expected failure"
  fi
}

assert_call() {
  grep -Fq -- "$1" "${CASE_DIR}/calls" || fail "missing docker call: $1"
}

assert_no_call() {
  if [[ -f "${CASE_DIR}/calls" ]] && grep -Fq -- "$1" "${CASE_DIR}/calls"; then
    fail "unexpected docker call: $1"
  fi
}

assert_restored_and_cleaned() {
  assert_call "service scale furanocoumarins_authd=3 furanocoumarins_go-auth=4"
  assert_call "service rm furanocoumarins_auth-import-once"
}

run_case success success
assert_status zero
assert_call "service create --name furanocoumarins_auth-import-once"
assert_call "service logs --raw --follow furanocoumarins_auth-import-once"
grep -Fq "Importer task state: Running" "${CASE_DIR}/output" || fail "missing live importer state"
assert_restored_and_cleaned
writer_check_line="$(grep -n 'service ps .*furanocoumarins_authd' "${CASE_DIR}/calls" | tail -n1 | cut -d: -f1)"
create_line="$(grep -n 'service create ' "${CASE_DIR}/calls" | head -n1 | cut -d: -f1)"
[[ "${create_line}" -gt "${writer_check_line}" ]] || fail "importer was created before writer shutdown checks"

VERSION_TAG_IMAGE="registry.example.test/furan-import:v2.4.1"
run_case version-tag success "${VERSION_TAG_IMAGE}"
assert_status zero
assert_call "${VERSION_TAG_IMAGE}"
assert_restored_and_cleaned

for scenario in failed rejected; do
  run_case "${scenario}" "${scenario}"
  assert_status nonzero
  assert_restored_and_cleaned
done

run_case writer-timeout writer_timeout
assert_status nonzero
assert_no_call "service create"
assert_restored_and_cleaned

run_case writer-inspection-failure writer_ps_error
assert_status nonzero
assert_no_call "service create"
assert_restored_and_cleaned

run_case importer-inspection-failure import_ps_error
assert_status nonzero
assert_call "service create --name furanocoumarins_auth-import-once"
assert_restored_and_cleaned

run_case importer-timeout import_timeout
assert_status nonzero
assert_call "service create --name furanocoumarins_auth-import-once"
assert_restored_and_cleaned

run_case mutable-image success "registry.example.test/furan-import:latest"
assert_status nonzero
assert_no_call "service scale"
assert_no_call "service create"
grep -Fq "pinned digest or explicit non-latest version tag" "${CASE_DIR}/output" || fail "missing pinned-image explanation"

echo "run-auth-import fake-Docker tests passed"
