#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
ENV_DIR="${ROOT_DIR}/env"

require_swarm() {
  if ! docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -qE 'active|manager'; then
    echo "Docker Swarm is not initialized. Run: docker swarm init"
    exit 1
  fi
}

create_secret() {
  local name="$1"
  local file="$2"
  if docker secret inspect "$name" >/dev/null 2>&1; then
    echo "Secret '${name}' already exists (remove manually to rotate)"
    return 0
  fi
  docker secret create "$name" "$file"
  echo "Created secret: ${name}"
}

extract_env_value() {
  local file="$1"
  local key="$2"
  grep -E "^${key}=" "$file" | head -n1 | cut -d= -f2-
}

require_swarm

for f in "${ENV_DIR}/.env" "${ENV_DIR}/postgres.env" "${ENV_DIR}/redis.env"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing ${f}. Run from repo root: ./cli init_env"
    exit 1
  fi
done

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

create_secret go_auth_env "${ENV_DIR}/.env"

printf '%s' "$(extract_env_value "${ENV_DIR}/postgres.env" POSTGRES_USER)" > "${TMP_DIR}/postgres_user"
printf '%s' "$(extract_env_value "${ENV_DIR}/postgres.env" POSTGRES_PASSWORD)" > "${TMP_DIR}/postgres_password"
printf '%s' "$(extract_env_value "${ENV_DIR}/postgres.env" POSTGRES_DB)" > "${TMP_DIR}/postgres_db"
create_secret postgres_user "${TMP_DIR}/postgres_user"
create_secret postgres_password "${TMP_DIR}/postgres_password"
create_secret postgres_db "${TMP_DIR}/postgres_db"

printf '%s' "$(extract_env_value "${ENV_DIR}/redis.env" REDIS_PASSWORD)" > "${TMP_DIR}/redis_password"
create_secret redis_password "${TMP_DIR}/redis_password"

echo "Secrets are ready. Deploy with: ./deploy/swarm/scripts/deploy.sh"
