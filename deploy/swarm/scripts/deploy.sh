#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
CONFIG_FILE="${ROOT_DIR}/deploy/swarm/production.conf"
USE_LOCAL=false
ALLOW_FRESH_CASSANDRA=false
source "${ROOT_DIR}/deploy/swarm/scripts/production-config.sh"
source "${ROOT_DIR}/deploy/swarm/scripts/callback-url.sh"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)
      USE_LOCAL=true
      shift
      ;;
    --fresh-cassandra)
      ALLOW_FRESH_CASSANDRA=true
      shift
      ;;
    --config)
      [[ $# -ge 2 ]] || { echo "Usage: $0 [--config FILE] [--local] [--fresh-cassandra]" >&2; exit 1; }
      CONFIG_FILE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--config FILE] [--local] [--fresh-cassandra]"
      exit 1
      ;;
  esac
done

load_production_config "${CONFIG_FILE}"
export AUTH_MASTER_IMAGE AUTH_POSTGRES_IMAGE FURANO_BACKEND_IMAGE
export AUTH_SMTP_HOST AUTH_SMTP_PORT AUTH_MAIL_FROM
export SWARM_CASSANDRA_VOLUME

cd "${ROOT_DIR}"

require_digest_image() {
  local variable="$1"
  local value="${!variable:-}"
  if [[ ! "${value}" =~ @sha256:[0-9a-fA-F]{64}$ ]]; then
    echo "${variable} must be set to an immutable image digest (repository@sha256:...)"
    exit 1
  fi
}

require_nonsecret_setting() {
  local variable="$1"
  if [[ -z "${!variable:-}" ]]; then
    echo "${variable} must be set"
    exit 1
  fi
}

require_digest_image AUTH_MASTER_IMAGE
require_digest_image AUTH_POSTGRES_IMAGE
require_digest_image FURANO_BACKEND_IMAGE
require_nonsecret_setting AUTH_SMTP_HOST
require_nonsecret_setting AUTH_MAIL_FROM

validate_callback_secret() {
  local secret_name="$1"
  local expected_path="$2"
  local value
  value="$(docker secret inspect --format '{{index .Spec.Annotations.Labels "furanocoumarins.callback-url"}}' "${secret_name}" 2>/dev/null || true)"
  if ! validate_callback_url "${value}" "${expected_path}"; then
    echo "Secret '${secret_name}' must have label furanocoumarins.callback-url=https://<frontend>${expected_path}" >&2
    echo "Swarm does not serve the SPA; create the secret with the exact externally hosted BrowserRouter route." >&2
    exit 1
  fi
  local status
  status="$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' "${value}" || true)"
  if [[ ! "${status}" =~ ^2[0-9][0-9]$ ]]; then
    echo "External BrowserRouter callback '${value}' is not ready (HTTP ${status:-unreachable})" >&2
    exit 1
  fi
  VALIDATED_CALLBACK_URL="${value}"
}

validate_go_auth_origin() {
  local magic_url="$1"
  local invite_url="$2"
  local allow_origin
  allow_origin="$(docker secret inspect --format '{{index .Spec.Annotations.Labels "furanocoumarins.allow-origin"}}' go_auth_env 2>/dev/null || true)"
  if ! validate_spa_origin_contract "${allow_origin}" "${magic_url}" "${invite_url}"; then
    echo "go_auth_env must label one exact HTTPS ALLOW_ORIGIN matching both callback origins" >&2
    echo "Wildcard, multiple, malformed, and mismatched origins are rejected for credentialed browser requests." >&2
    exit 1
  fi
  if ! validate_spa_origin_contract "${PUBLIC_APP_ORIGIN}" "${magic_url}" "${invite_url}"; then
    echo "production.conf PUBLIC_APP_ORIGIN does not match the initialized callback secrets" >&2
    echo "Remove and recreate the callback and go_auth_env secrets before deploying this origin." >&2
    exit 1
  fi
}

if ! docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -qE 'active|manager'; then
  echo "Docker Swarm is not initialized. Run: docker swarm init"
  exit 1
fi

prepare_cassandra_volume() {
  local kind source_label marker
  if ! docker volume inspect "${SWARM_CASSANDRA_VOLUME}" >/dev/null 2>&1; then
    if [[ "${ALLOW_FRESH_CASSANDRA}" != true ]]; then
      echo "Prepared Swarm Cassandra volume '${SWARM_CASSANDRA_VOLUME}' does not exist." >&2
      echo "Run: ./deploy/swarm/scripts/migrate-cassandra-volume.sh" >&2
      echo "For a confirmed new installation with no Cassandra data, use deploy.sh --fresh-cassandra." >&2
      exit 1
    fi
    if docker volume inspect "${LEGACY_CASSANDRA_VOLUME}" >/dev/null 2>&1; then
      echo "Refusing --fresh-cassandra because legacy volume '${LEGACY_CASSANDRA_VOLUME}' exists." >&2
      exit 1
    fi
    docker volume create \
      --label furanocoumarins.cassandra-volume=fresh \
      "${SWARM_CASSANDRA_VOLUME}" >/dev/null
  fi

  kind="$(docker volume inspect --format '{{index .Labels "furanocoumarins.cassandra-volume"}}' "${SWARM_CASSANDRA_VOLUME}" 2>/dev/null || true)"
  if [[ "${kind}" == "fresh" ]]; then
    if docker volume inspect "${LEGACY_CASSANDRA_VOLUME}" >/dev/null 2>&1; then
      echo "Refusing an empty/fresh Swarm Cassandra volume while legacy data exists." >&2
      echo "Remove the unused target volume explicitly, then run migrate-cassandra-volume.sh." >&2
      exit 1
    fi
    return 0
  fi
  if [[ "${kind}" != "migration-v1" ]]; then
    echo "Swarm Cassandra volume '${SWARM_CASSANDRA_VOLUME}' is not managed by this deployment." >&2
    exit 1
  fi
  source_label="$(docker volume inspect --format '{{index .Labels "furanocoumarins.cassandra-source"}}' "${SWARM_CASSANDRA_VOLUME}" 2>/dev/null || true)"
  marker="$(docker run --rm --user 0 \
    --mount "type=volume,src=${SWARM_CASSANDRA_VOLUME},dst=/target,readonly" \
    cassandra:3.11.9 sh -ec 'cat /target/.furanocoumarins-cassandra-migration-v1' 2>/dev/null || true)"
  if [[ "${source_label}" != "${LEGACY_CASSANDRA_VOLUME}" ]] ||
    ! grep -Fxq 'version=1' <<<"${marker}" ||
    ! grep -Fxq "source=${LEGACY_CASSANDRA_VOLUME}" <<<"${marker}" ||
    ! grep -Eq '^manifest=sha256:[0-9a-f]{64}$' <<<"${marker}"; then
    echo "Swarm Cassandra volume has no valid completed-migration marker." >&2
    echo "Do not deploy; rerun or repair migrate-cassandra-volume.sh first." >&2
    exit 1
  fi
}

prepare_cassandra_volume

REQUIRED_SECRETS=(
  go_auth_env postgres_user postgres_password postgres_db redis_password
  auth_postgres_user auth_postgres_password auth_postgres_db auth_database_url
  auth_password_history_key auth_signing_key auth_magic_callback_url auth_invite_callback_url
  auth_smtp_user auth_smtp_password
)
for secret in "${REQUIRED_SECRETS[@]}"; do
  if ! docker secret inspect "$secret" >/dev/null 2>&1; then
    echo "Missing secret '${secret}'. Run: ./deploy/swarm/scripts/init-secrets.sh"
    exit 1
  fi
done
validate_callback_secret auth_magic_callback_url /admit
MAGIC_CALLBACK_URL="${VALIDATED_CALLBACK_URL}"
validate_callback_secret auth_invite_callback_url /register
INVITE_CALLBACK_URL="${VALIDATED_CALLBACK_URL}"
validate_go_auth_origin "${MAGIC_CALLBACK_URL}" "${INVITE_CALLBACK_URL}"

if [[ ! -f monitoring/grafana.ini ]]; then
  echo "Missing monitoring/grafana.ini. Run from repo root: ./cli init_env"
  exit 1
fi

if [[ ! -d /etc/letsencrypt/live ]]; then
  echo "Warning: /etc/letsencrypt/live not found. Obtain certificates with certbot before nginx can serve HTTPS."
fi

COMPOSE_FILES=(-c deploy/swarm/stack.yaml)
if [[ "${USE_LOCAL}" == true ]]; then
  COMPOSE_FILES+=(-c deploy/swarm/stack.local.yaml)
fi

echo "Deploying stack '${STACK_NAME}' from ${ROOT_DIR}..."
docker stack deploy "${COMPOSE_FILES[@]}" "${STACK_NAME}"

wait_for_local_service_health() {
  local service="$1" attempts=90 attempt desired ids id status healthy
  echo "Waiting for ${service} to become healthy..."
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    desired="$(docker service inspect --format '{{.Spec.Mode.Replicated.Replicas}}' "${service}" 2>/dev/null || true)"
    ids="$(docker ps --filter "label=com.docker.swarm.service.name=${service}" --format '{{.ID}}' 2>/dev/null || true)"
    healthy=0
    for id in ${ids}; do
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${id}" 2>/dev/null || true)"
      [[ "${status}" == "healthy" || "${status}" == "running" ]] && healthy=$((healthy + 1))
    done
    if [[ "${desired}" =~ ^[1-9][0-9]*$ && "${healthy}" -eq "${desired}" ]]; then
      echo "${service} is healthy (${healthy}/${desired})"
      return 0
    fi
    sleep 2
  done
  echo "${service} did not become healthy within 180 seconds" >&2
  docker service ps --no-trunc "${service}" >&2 || true
  return 1
}

# The production guide runs the offline import immediately after this command.
# Wait for authd's schema migration and the BFF healthcheck first so that the
# copy-paste deployment sequence cannot race auth-master initialization.
wait_for_local_service_health "${STACK_NAME}_authd"
wait_for_local_service_health "${STACK_NAME}_go-auth"

echo
echo "Stack deployed. Check status:"
echo "  docker stack ps ${STACK_NAME}"
echo "  docker service ls"
