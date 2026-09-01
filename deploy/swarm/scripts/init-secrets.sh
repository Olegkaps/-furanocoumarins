#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
ENV_DIR="${ROOT_DIR}/env"
source "${ROOT_DIR}/deploy/swarm/scripts/callback-url.sh"
source "${ROOT_DIR}/deploy/swarm/scripts/callback-secret.sh"

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

create_secret_from_file_variable() {
  local name="$1"
  local variable="$2"
  local file="${!variable:-}"
  if [[ -z "${file}" ]]; then
    echo "${variable} must point to the file used for Docker secret '${name}'"
    exit 1
  fi
  if [[ ! -r "${file}" || ! -s "${file}" ]]; then
    echo "${variable} must point to a readable, non-empty file"
    exit 1
  fi
  create_secret "${name}" "${file}"
}

extract_env_value() {
  local file="$1"
  local key="$2"
  grep -E "^${key}=" "$file" | head -n1 | cut -d= -f2-
}

create_go_auth_secret() {
  local env_file="$1"
  local magic_file="$2"
  local invite_file="$3"
  local allow_origin magic_url invite_url
  allow_origin="$(extract_env_value "${env_file}" ALLOW_ORIGIN)"
  magic_url="$(<"${magic_file}")"
  invite_url="$(<"${invite_file}")"
  if ! validate_spa_origin_contract "${allow_origin}" "${magic_url}" "${invite_url}"; then
    echo "ALLOW_ORIGIN must be one exact HTTPS SPA origin matching both callback URL origins" >&2
    exit 1
  fi
  if docker secret inspect go_auth_env >/dev/null 2>&1; then
    echo "Secret 'go_auth_env' already exists (remove manually to rotate)"
    return 0
  fi
  docker secret create --label "furanocoumarins.allow-origin=${allow_origin}" go_auth_env "${env_file}"
  echo "Created secret: go_auth_env"
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

normalize_callback_secret_file "${AUTH_MAGIC_CALLBACK_URL_FILE:-}" "${TMP_DIR}/auth_magic_callback_url"
normalize_callback_secret_file "${AUTH_INVITE_CALLBACK_URL_FILE:-}" "${TMP_DIR}/auth_invite_callback_url"
create_go_auth_secret "${ENV_DIR}/.env" "${TMP_DIR}/auth_magic_callback_url" "${TMP_DIR}/auth_invite_callback_url"

printf '%s' "$(extract_env_value "${ENV_DIR}/postgres.env" POSTGRES_USER)" > "${TMP_DIR}/postgres_user"
printf '%s' "$(extract_env_value "${ENV_DIR}/postgres.env" POSTGRES_PASSWORD)" > "${TMP_DIR}/postgres_password"
printf '%s' "$(extract_env_value "${ENV_DIR}/postgres.env" POSTGRES_DB)" > "${TMP_DIR}/postgres_db"
create_secret postgres_user "${TMP_DIR}/postgres_user"
create_secret postgres_password "${TMP_DIR}/postgres_password"
create_secret postgres_db "${TMP_DIR}/postgres_db"

printf '%s' "$(extract_env_value "${ENV_DIR}/redis.env" REDIS_PASSWORD)" > "${TMP_DIR}/redis_password"
create_secret redis_password "${TMP_DIR}/redis_password"

# Sensitive auth-master values are deliberately accepted only as file paths.
# Callback URLs are not credentials: their non-secret route is duplicated in a
# Docker label so deploy.sh can fail closed without reading secret contents.
create_secret_from_file_variable auth_postgres_user AUTH_POSTGRES_USER_FILE
create_secret_from_file_variable auth_postgres_password AUTH_POSTGRES_PASSWORD_FILE
create_secret_from_file_variable auth_postgres_db AUTH_POSTGRES_DB_FILE
create_secret_from_file_variable auth_database_url AUTH_DATABASE_URL_FILE
create_secret_from_file_variable auth_source_database_url FURANO_SOURCE_DATABASE_URL_FILE
create_secret_from_file_variable auth_selected_superuser FURANO_SUPERUSER_FILE
create_secret_from_file_variable auth_password_history_key AUTH_PASSWORD_HISTORY_KEY_FILE
create_secret_from_file_variable auth_signing_key AUTH_SIGNING_KEY_FILE
create_normalized_callback_secret auth_magic_callback_url "${TMP_DIR}/auth_magic_callback_url" /admit
create_normalized_callback_secret auth_invite_callback_url "${TMP_DIR}/auth_invite_callback_url" /register
create_secret_from_file_variable auth_smtp_user AUTH_SMTP_USER_FILE
create_secret_from_file_variable auth_smtp_password AUTH_SMTP_PASSWORD_FILE

echo "Secrets are ready. Deploy with: ./deploy/swarm/scripts/deploy.sh"
