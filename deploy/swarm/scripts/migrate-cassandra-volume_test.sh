#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
RUNNER="${ROOT_DIR}/deploy/swarm/scripts/migrate-cassandra-volume.sh"
DEPLOY_RUNNER="${ROOT_DIR}/deploy/swarm/scripts/deploy.sh"
FAKE_BIN="${ROOT_DIR}/deploy/swarm/scripts/testdata"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "${TEST_ROOT}"' EXIT

DIGEST="sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

fail() {
  echo "Cassandra volume migration test failed: $*" >&2
  exit 1
}

write_config() {
  local file="$1"
  cat >"${file}" <<CONFIG
STACK_NAME=furanocoumarins
PUBLIC_APP_ORIGIN=https://front.example.test
AUTH_MASTER_IMAGE=registry.example.test/auth@${DIGEST}
FURANO_IMPORT_IMAGE=registry.example.test/import@${DIGEST}
FURANO_BACKEND_IMAGE=registry.example.test/backend@${DIGEST}
AUTH_POSTGRES_IMAGE=postgres@${DIGEST}
AUTH_SMTP_HOST=smtp.example.test
AUTH_MAIL_FROM=auth@example.test
FURANO_SUPERUSER=admin@example.test
CONFIG
}

run_case() {
  local name="$1" scenario="$2"
  CASE_DIR="${TEST_ROOT}/${name}"
  mkdir -p "${CASE_DIR}"
  write_config "${CASE_DIR}/production.conf"
  set +e
  PATH="${FAKE_BIN}:${PATH}" FAKE_DOCKER_STATE="${CASE_DIR}" FAKE_SCENARIO="${scenario}" \
    "${RUNNER}" --config "${CASE_DIR}/production.conf" >"${CASE_DIR}/output" 2>&1
  CASE_STATUS=$?
  set -e
}

assert_call() {
  grep -Fq -- "$1" "${CASE_DIR}/calls" || fail "missing Docker call: $1"
}

assert_no_call() {
  if [[ -f "${CASE_DIR}/calls" ]] && grep -Fq -- "$1" "${CASE_DIR}/calls"; then
    fail "unexpected Docker call: $1"
  fi
}

run_case success cassandra-success
[[ "${CASE_STATUS}" -eq 0 ]] || { cat "${CASE_DIR}/output" >&2; fail "copy should succeed"; }
assert_call "stop go-auth"
assert_call "exec -T cassandra nodetool drain"
assert_call "stop cassandra"
assert_call "volume create --label furanocoumarins.cassandra-volume=migration-v1"
assert_call "src=furanocoumarins_cassandra3_data,dst=/source,readonly"
assert_call "src=furanocoumarins_swarm_cassandra3_data,dst=/target"
assert_no_call "up -d cassandra"
assert_no_call "up -d go-auth"

stop_line="$(grep -n 'stop cassandra' "${CASE_DIR}/calls" | head -n1 | cut -d: -f1)"
copy_line="$(grep -n '^run ' "${CASE_DIR}/calls" | tail -n1 | cut -d: -f1)"
[[ "${copy_line}" -gt "${stop_line}" ]] || fail "copy began before Cassandra stopped"

run_case failure cassandra-copy-failure
[[ "${CASE_STATUS}" -ne 0 ]] || fail "copy failure was ignored"
assert_call "volume rm furanocoumarins_swarm_cassandra3_data"
assert_call "restart cassandra"
assert_call "up -d go-auth"

run_case missing cassandra-source-missing
[[ "${CASE_STATUS}" -ne 0 ]] || fail "missing source volume was accepted"
assert_no_call "stop go-auth"
assert_no_call "volume create"

run_case idempotent cassandra-success
: >"${CASE_DIR}/target-exists"
: >"${CASE_DIR}/target-ready"
set +e
PATH="${FAKE_BIN}:${PATH}" FAKE_DOCKER_STATE="${CASE_DIR}" FAKE_SCENARIO=cassandra-success \
  "${RUNNER}" --config "${CASE_DIR}/production.conf" >"${CASE_DIR}/rerun-output" 2>&1
rerun_status=$?
set -e
[[ "${rerun_status}" -eq 0 ]] || { cat "${CASE_DIR}/rerun-output" >&2; fail "completed rerun should be a no-op"; }
grep -Fq "already complete" "${CASE_DIR}/rerun-output" || fail "completed rerun was not explained"
copy_runs="$(grep -c 'src=furanocoumarins_cassandra3_data,dst=/source,readonly' "${CASE_DIR}/calls" || true)"
[[ "${copy_runs}" -eq 1 ]] || fail "idempotent check performed a second data copy"

grep -Fq 'nodetool drain' "${RUNNER}" || fail "migration does not drain Cassandra"
grep -Fq 'sha256sum' "${RUNNER}" || fail "migration does not checksum copied files"
grep -Fq 'tar --numeric-owner' "${RUNNER}" || fail "migration does not preserve filesystem ownership"

CASE_DIR="${TEST_ROOT}/deploy-guard"
mkdir -p "${CASE_DIR}"
write_config "${CASE_DIR}/production.conf"
set +e
PATH="${FAKE_BIN}:${PATH}" FAKE_DOCKER_STATE="${CASE_DIR}" FAKE_SCENARIO=cassandra-success \
  "${DEPLOY_RUNNER}" --config "${CASE_DIR}/production.conf" >"${CASE_DIR}/output" 2>&1
deploy_status=$?
set -e
[[ "${deploy_status}" -ne 0 ]] || fail "deploy accepted a missing Cassandra target"
grep -Fq 'migrate-cassandra-volume.sh' "${CASE_DIR}/output" || fail "deploy did not explain the required cutover"
if grep -Fq 'stack deploy' "${CASE_DIR}/calls"; then
  fail "stack deployment began before Cassandra migration"
fi

echo "Cassandra volume migration fake-Docker tests passed"
