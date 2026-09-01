#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
STACK_NAME="${STACK_NAME:-furanocoumarins}"
USE_LOCAL=false
source "${ROOT_DIR}/deploy/swarm/scripts/callback-url.sh"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)
      USE_LOCAL=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--local]"
      exit 1
      ;;
  esac
done

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
}

if ! docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -qE 'active|manager'; then
  echo "Docker Swarm is not initialized. Run: docker swarm init"
  exit 1
fi

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

echo
echo "Stack deployed. Check status:"
echo "  docker stack ps ${STACK_NAME}"
echo "  docker service ls"
