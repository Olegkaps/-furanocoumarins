#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
CONFIG_FILE="${ROOT_DIR}/deploy/swarm/production.conf"
source "${ROOT_DIR}/deploy/swarm/scripts/production-config.sh"
source "${ROOT_DIR}/deploy/swarm/scripts/image-reference.sh"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) [[ $# -ge 2 ]] || { echo "Usage: $0 [--config FILE]" >&2; exit 1; }; CONFIG_FILE="$2"; shift 2 ;;
    -h|--help) echo "Usage: $0 [--config FILE]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; echo "Usage: $0 [--config FILE]" >&2; exit 1 ;;
  esac
done

load_production_config "${CONFIG_FILE}"
JOB_NAME="${STACK_NAME}_auth-import-once"
WRITER_STOP_ATTEMPTS="${WRITER_STOP_ATTEMPTS:-60}"
WRITER_STOP_INTERVAL="${WRITER_STOP_INTERVAL:-1}"
IMPORT_ATTEMPTS="${IMPORT_ATTEMPTS:-120}"
IMPORT_INTERVAL="${IMPORT_INTERVAL:-2}"

for numeric in WRITER_STOP_ATTEMPTS WRITER_STOP_INTERVAL IMPORT_ATTEMPTS IMPORT_INTERVAL; do
  if [[ ! "${!numeric}" =~ ^[0-9]+$ ]] || [[ "${!numeric}" -lt 1 && "${numeric}" != *_INTERVAL ]]; then
    echo "${numeric} must be a non-negative integer, and attempt counts must be positive" >&2
    exit 1
  fi
done

require_pinned_image_reference FURANO_IMPORT_IMAGE

for secret in auth_source_database_url auth_database_url auth_selected_superuser; do
  if ! docker secret inspect "${secret}" >/dev/null 2>&1; then
    echo "Missing secret '${secret}'. Run deploy/swarm/scripts/init-secrets.sh first."
    exit 1
  fi
done

GO_AUTH_SERVICE="${STACK_NAME}_go-auth"
AUTHD_SERVICE="${STACK_NAME}_authd"
NETWORK="${STACK_NAME}_back"
for object in "${GO_AUTH_SERVICE}" "${AUTHD_SERVICE}"; do
  if ! docker service inspect "${object}" >/dev/null 2>&1; then
    echo "Missing deployed service '${object}'; deploy the stack before migration"
    exit 1
  fi
done

go_auth_replicas="$(docker service inspect --format '{{.Spec.Mode.Replicated.Replicas}}' "${GO_AUTH_SERVICE}")"
authd_replicas="$(docker service inspect --format '{{.Spec.Mode.Replicated.Replicas}}' "${AUTHD_SERVICE}")"

restore_services() {
  docker service rm "${JOB_NAME}" >/dev/null 2>&1 || true
  docker service scale "${AUTHD_SERVICE}=${authd_replicas}" "${GO_AUTH_SERVICE}=${go_auth_replicas}" >/dev/null
}
trap restore_services EXIT

echo "Stopping application and auth writes before the atomic offline import..."
docker service scale "${GO_AUTH_SERVICE}=0" "${AUTHD_SERVICE}=0" >/dev/null
active_tasks() {
	local states
	states="$(docker service ps --no-trunc --format '{{.CurrentState}}' "$1")" || return 1
	printf '%s\n' "${states}" | grep -E '^(New|Pending|Assigned|Accepted|Preparing|Ready|Starting|Running)' || true
}
for _ in $(seq 1 "${WRITER_STOP_ATTEMPTS}"); do
  # Inspect CurrentState without a desired-state filter: after scale=0 Docker
  # marks a still-running task DesiredState=Shutdown before its process exits.
	if ! go_auth_running="$(active_tasks "${GO_AUTH_SERVICE}")"; then
		echo "Could not verify that application writers stopped" >&2
		exit 1
	fi
	if ! authd_running="$(active_tasks "${AUTHD_SERVICE}")"; then
		echo "Could not verify that authd writers stopped" >&2
		exit 1
	fi
  if [[ -z "${go_auth_running}" && -z "${authd_running}" ]]; then
    break
  fi
  sleep "${WRITER_STOP_INTERVAL}"
done
if [[ -n "${go_auth_running}" || -n "${authd_running}" ]]; then
  echo "Application writers did not stop; refusing to start the importer" >&2
  exit 1
fi

docker service rm "${JOB_NAME}" >/dev/null 2>&1 || true
docker service create \
  --name "${JOB_NAME}" \
  --network "${NETWORK}" \
  --secret source=auth_source_database_url,target=auth_source_database_url \
  --secret source=auth_database_url,target=auth_database_url \
  --secret source=auth_selected_superuser,target=auth_selected_superuser \
  --env FURANO_SOURCE_DATABASE_URL_FILE=/run/secrets/auth_source_database_url \
  --env DATABASE_URL_FILE=/run/secrets/auth_database_url \
  --env FURANO_SUPERUSER_FILE=/run/secrets/auth_selected_superuser \
  --restart-condition none \
  "${FURANO_IMPORT_IMAGE}" >/dev/null

echo "Waiting for one-shot importer..."
for _ in $(seq 1 "${IMPORT_ATTEMPTS}"); do
	if ! state="$(docker service ps --no-trunc --format '{{.CurrentState}}' "${JOB_NAME}" | head -n1)"; then
		echo "Could not inspect the one-shot importer state" >&2
		exit 1
	fi
  case "${state}" in
    Complete*)
      docker service logs "${JOB_NAME}"
      echo "Import completed; restoring authd and application replicas."
      exit 0
      ;;
    Failed*|Rejected*)
      docker service logs "${JOB_NAME}" >&2 || true
      echo "Import failed (${state}); restoring services without retrying the importer." >&2
      exit 1
      ;;
  esac
  sleep "${IMPORT_INTERVAL}"
done

docker service logs "${JOB_NAME}" >&2 || true
echo "Import did not finish within the configured timeout" >&2
exit 1
