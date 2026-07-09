#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
STACK_NAME="${STACK_NAME:-furanocoumarins}"
USE_LOCAL=false

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

if ! docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -qE 'active|manager'; then
  echo "Docker Swarm is not initialized. Run: docker swarm init"
  exit 1
fi

REQUIRED_SECRETS=(go_auth_env postgres_user postgres_password postgres_db redis_password)
for secret in "${REQUIRED_SECRETS[@]}"; do
  if ! docker secret inspect "$secret" >/dev/null 2>&1; then
    echo "Missing secret '${secret}'. Run: ./deploy/swarm/scripts/init-secrets.sh"
    exit 1
  fi
done

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
