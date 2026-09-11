#!/usr/bin/env bash

production_config_default() {
  local root_dir="$1"
  printf '%s' "${root_dir}/deploy/swarm/production.conf"
}

load_production_config() {
  local file="$1"
  if [[ ! -r "${file}" || ! -s "${file}" ]]; then
    echo "Missing production config: ${file}" >&2
    echo "Create it with: cp deploy/swarm/production.conf.example deploy/swarm/production.conf" >&2
    return 1
  fi

  unset STACK_NAME PUBLIC_APP_ORIGIN AUTH_MASTER_IMAGE FURANO_IMPORT_IMAGE
  unset FURANO_BACKEND_IMAGE AUTH_POSTGRES_IMAGE AUTH_SMTP_HOST AUTH_SMTP_PORT
  unset AUTH_MAIL_FROM AUTH_SMTP_USER FURANO_SUPERUSER
  unset LEGACY_POSTGRES_CONTAINER_ID

  local line key value line_number=0 seen=' '
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line_number=$((line_number + 1))
    line="${line%$'\r'}"
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    if [[ "${line}" != *=* ]]; then
      echo "${file}:${line_number}: expected KEY=value" >&2
      return 1
    fi
    key="${line%%=*}"
    value="${line#*=}"
    case "${key}" in
      STACK_NAME|PUBLIC_APP_ORIGIN|AUTH_MASTER_IMAGE|FURANO_IMPORT_IMAGE|FURANO_BACKEND_IMAGE|AUTH_POSTGRES_IMAGE|AUTH_SMTP_HOST|AUTH_SMTP_PORT|AUTH_MAIL_FROM|AUTH_SMTP_USER|FURANO_SUPERUSER|LEGACY_POSTGRES_CONTAINER_ID) ;;
      *) echo "${file}:${line_number}: unknown setting '${key}'" >&2; return 1 ;;
    esac
    if [[ "${seen}" == *" ${key} "* ]]; then
      echo "${file}:${line_number}: duplicate setting '${key}'" >&2
      return 1
    fi
    if [[ "${value}" == \"* || "${value}" == *\" || "${value}" == \'* || "${value}" == *\' ]]; then
      echo "${file}:${line_number}: values are literal; remove quotes around '${key}'" >&2
      return 1
    fi
    seen="${seen}${key} "
    printf -v "${key}" '%s' "${value}"
  done <"${file}"

  STACK_NAME="${STACK_NAME:-furanocoumarins}"
  AUTH_SMTP_PORT="${AUTH_SMTP_PORT:-587}"
  AUTH_SMTP_USER="${AUTH_SMTP_USER:-}"
  LEGACY_POSTGRES_CONTAINER_ID="${LEGACY_POSTGRES_CONTAINER_ID:-}"

  local required
  for required in PUBLIC_APP_ORIGIN AUTH_MASTER_IMAGE FURANO_IMPORT_IMAGE FURANO_BACKEND_IMAGE AUTH_POSTGRES_IMAGE AUTH_SMTP_HOST AUTH_MAIL_FROM FURANO_SUPERUSER; do
    if [[ -z "${!required:-}" ]]; then
      echo "${file}: ${required} must be set" >&2
      return 1
    fi
  done
  [[ "${STACK_NAME}" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || {
    echo "${file}: STACK_NAME contains unsupported characters" >&2
    return 1
  }
  [[ "${AUTH_SMTP_PORT}" =~ ^[0-9]+$ ]] || {
    echo "${file}: AUTH_SMTP_PORT must be numeric" >&2
    return 1
  }
}
