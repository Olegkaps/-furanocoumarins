#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
CONFIG_FILE="${ROOT_DIR}/deploy/swarm/production.conf"
ENV_DIR="${ROOT_DIR}/env"
source "${ROOT_DIR}/deploy/swarm/scripts/production-config.sh"
source "${ROOT_DIR}/deploy/swarm/scripts/callback-url.sh"
source "${ROOT_DIR}/deploy/swarm/scripts/callback-secret.sh"

usage() {
  echo "Usage: $0 [--config FILE] [--env-dir DIR]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) [[ $# -ge 2 ]] || { usage >&2; exit 1; }; CONFIG_FILE="$2"; shift 2 ;;
    --env-dir) [[ $# -ge 2 ]] || { usage >&2; exit 1; }; ENV_DIR="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

load_production_config "${CONFIG_FILE}"

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
  docker secret create "$name" "$file" >/dev/null
  echo "Created secret: ${name}"
}

extract_env_value() {
  local file="$1"
  local key="$2"
  local raw
  raw="$(grep -E "^${key}=" "$file" | head -n1 | cut -d= -f2- || true)"
  if [[ "${raw}" == \"*\" && "${raw}" == *\" ]]; then
    raw="${raw#\"}"
    raw="${raw%\"}"
  elif [[ "${raw}" == \'*\' && "${raw}" == *\' ]]; then
    raw="${raw#\'}"
    raw="${raw%\'}"
  fi
  printf '%s' "${raw}"
}

require_env_value() {
  local file="$1" key="$2" value
  value="$(extract_env_value "${file}" "${key}")"
  if [[ -z "${value}" ]]; then
    echo "${file}: ${key} must be set" >&2
    exit 1
  fi
  printf '%s' "${value}"
}

urlencode() {
  local LC_ALL=C value="$1" output='' char index
  for ((index = 0; index < ${#value}; index++)); do
    char="${value:index:1}"
    case "${char}" in
      [a-zA-Z0-9.~_-]) output+="${char}" ;;
      *) printf -v char '%%%02X' "'${char}"; output+="${char}" ;;
    esac
  done
  printf '%s' "${output}"
}

write_go_auth_env() {
  local source_file="$1" destination="$2" line
  local saw_origin=false saw_domain=false saw_type=false
  : >"${destination}"
  while IFS= read -r line || [[ -n "${line}" ]]; do
    case "${line}" in
      ALLOW_ORIGIN=*) printf 'ALLOW_ORIGIN="%s"\n' "${PUBLIC_APP_ORIGIN}" >>"${destination}"; saw_origin=true ;;
      DOMAIN_PREF=*) printf 'DOMAIN_PREF="%s"\n' "${PUBLIC_APP_ORIGIN}" >>"${destination}"; saw_domain=true ;;
      ENV_TYPE=*) printf 'ENV_TYPE="PROD"\n' >>"${destination}"; saw_type=true ;;
      *) printf '%s\n' "${line}" >>"${destination}" ;;
    esac
  done <"${source_file}"
  [[ "${saw_origin}" == true ]] || printf 'ALLOW_ORIGIN="%s"\n' "${PUBLIC_APP_ORIGIN}" >>"${destination}"
  [[ "${saw_domain}" == true ]] || printf 'DOMAIN_PREF="%s"\n' "${PUBLIC_APP_ORIGIN}" >>"${destination}"
  [[ "${saw_type}" == true ]] || printf 'ENV_TYPE="PROD"\n' >>"${destination}"
}

create_generated_secret() {
  local name="$1" bytes="$2" file="$3"
  if docker secret inspect "${name}" >/dev/null 2>&1; then
    echo "Secret '${name}' already exists"
    return 0
  fi
  openssl rand -hex "${bytes}" >"${file}"
  create_secret "${name}" "${file}"
}

create_go_auth_secret() {
  local env_file="$1"
  local magic_url="$2"
  local invite_url="$3"
  if ! validate_spa_origin_contract "${PUBLIC_APP_ORIGIN}" "${magic_url}" "${invite_url}"; then
    echo "PUBLIC_APP_ORIGIN must be one exact external HTTPS SPA origin" >&2
    exit 1
  fi
  if docker secret inspect go_auth_env >/dev/null 2>&1; then
    echo "Secret 'go_auth_env' already exists (remove manually to rotate)"
    return 0
  fi
  docker secret create --label "furanocoumarins.allow-origin=${PUBLIC_APP_ORIGIN}" go_auth_env "${env_file}" >/dev/null
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

MAGIC_CALLBACK_URL="${PUBLIC_APP_ORIGIN}/admit"
INVITE_CALLBACK_URL="${PUBLIC_APP_ORIGIN}/register"
if ! validate_spa_origin_contract "${PUBLIC_APP_ORIGIN}" "${MAGIC_CALLBACK_URL}" "${INVITE_CALLBACK_URL}"; then
  echo "PUBLIC_APP_ORIGIN must look like https://frontend.example (no localhost, path, query, or fragment)" >&2
  exit 1
fi
printf '%s' "${MAGIC_CALLBACK_URL}" >"${TMP_DIR}/auth_magic_callback_url"
printf '%s' "${INVITE_CALLBACK_URL}" >"${TMP_DIR}/auth_invite_callback_url"
write_go_auth_env "${ENV_DIR}/.env" "${TMP_DIR}/go_auth.env"
create_go_auth_secret "${TMP_DIR}/go_auth.env" "${MAGIC_CALLBACK_URL}" "${INVITE_CALLBACK_URL}"

POSTGRES_USER="$(require_env_value "${ENV_DIR}/postgres.env" POSTGRES_USER)"
POSTGRES_PASSWORD="$(require_env_value "${ENV_DIR}/postgres.env" POSTGRES_PASSWORD)"
POSTGRES_DB="$(require_env_value "${ENV_DIR}/postgres.env" POSTGRES_DB)"
REDIS_PASSWORD="$(require_env_value "${ENV_DIR}/redis.env" REDIS_PASSWORD)"
printf '%s' "${POSTGRES_USER}" > "${TMP_DIR}/postgres_user"
printf '%s' "${POSTGRES_PASSWORD}" > "${TMP_DIR}/postgres_password"
printf '%s' "${POSTGRES_DB}" > "${TMP_DIR}/postgres_db"
create_secret postgres_user "${TMP_DIR}/postgres_user"
create_secret postgres_password "${TMP_DIR}/postgres_password"
create_secret postgres_db "${TMP_DIR}/postgres_db"

printf '%s' "${REDIS_PASSWORD}" > "${TMP_DIR}/redis_password"
create_secret redis_password "${TMP_DIR}/redis_password"

AUTH_DB_SECRETS=(auth_postgres_user auth_postgres_password auth_postgres_db auth_database_url)
AUTH_DB_PRESENT=0
for secret in "${AUTH_DB_SECRETS[@]}"; do
  docker secret inspect "${secret}" >/dev/null 2>&1 && AUTH_DB_PRESENT=$((AUTH_DB_PRESENT + 1))
done
if [[ "${AUTH_DB_PRESENT}" -ne 0 && "${AUTH_DB_PRESENT}" -ne "${#AUTH_DB_SECRETS[@]}" ]]; then
  echo "Auth database secrets are only partially initialized." >&2
  echo "Remove the four unattached auth database secrets and rerun this command." >&2
  exit 1
fi
if [[ "${AUTH_DB_PRESENT}" -eq 0 ]]; then
  AUTH_DB_USER=auth_master
  AUTH_DB_NAME=auth_master
  AUTH_DB_PASSWORD="$(openssl rand -hex 24)"
  printf '%s' "${AUTH_DB_USER}" >"${TMP_DIR}/auth_postgres_user"
  printf '%s' "${AUTH_DB_PASSWORD}" >"${TMP_DIR}/auth_postgres_password"
  printf '%s' "${AUTH_DB_NAME}" >"${TMP_DIR}/auth_postgres_db"
  printf 'postgres://%s:%s@auth-postgres:5432/%s?sslmode=disable' \
    "$(urlencode "${AUTH_DB_USER}")" "$(urlencode "${AUTH_DB_PASSWORD}")" "$(urlencode "${AUTH_DB_NAME}")" \
    >"${TMP_DIR}/auth_database_url"
  for secret in "${AUTH_DB_SECRETS[@]}"; do
    create_secret "${secret}" "${TMP_DIR}/${secret}"
  done
else
  echo "Auth database secrets already exist"
fi

printf 'postgres://%s:%s@postgres:5432/%s?sslmode=disable' \
  "$(urlencode "${POSTGRES_USER}")" "$(urlencode "${POSTGRES_PASSWORD}")" "$(urlencode "${POSTGRES_DB}")" \
  >"${TMP_DIR}/auth_source_database_url"
printf '%s' "${FURANO_SUPERUSER}" >"${TMP_DIR}/auth_selected_superuser"
create_secret auth_source_database_url "${TMP_DIR}/auth_source_database_url"
create_secret auth_selected_superuser "${TMP_DIR}/auth_selected_superuser"
create_generated_secret auth_password_history_key 32 "${TMP_DIR}/auth_password_history_key"
create_generated_secret auth_signing_key 32 "${TMP_DIR}/auth_signing_key"
create_normalized_callback_secret auth_magic_callback_url "${TMP_DIR}/auth_magic_callback_url" /admit
create_normalized_callback_secret auth_invite_callback_url "${TMP_DIR}/auth_invite_callback_url" /register

SMTP_USER="${AUTH_SMTP_USER:-$(extract_env_value "${ENV_DIR}/.env" MAIL)}"
SMTP_PASSWORD="$(extract_env_value "${ENV_DIR}/.env" AUTH_SMTP_PASSWORD)"
[[ -n "${SMTP_PASSWORD}" ]] || SMTP_PASSWORD="$(extract_env_value "${ENV_DIR}/.env" MAIL_SECRET)"
if [[ -z "${SMTP_USER}" || -z "${SMTP_PASSWORD}" ]]; then
  echo "Set AUTH_SMTP_USER in production.conf (or MAIL in env/.env) and MAIL_SECRET in env/.env" >&2
  exit 1
fi
printf '%s' "${SMTP_USER}" >"${TMP_DIR}/auth_smtp_user"
printf '%s' "${SMTP_PASSWORD}" >"${TMP_DIR}/auth_smtp_password"
create_secret auth_smtp_user "${TMP_DIR}/auth_smtp_user"
create_secret auth_smtp_password "${TMP_DIR}/auth_smtp_password"

echo "Secrets are ready. Deploy with: ./deploy/swarm/scripts/deploy.sh"
