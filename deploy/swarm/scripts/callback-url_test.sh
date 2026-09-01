#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/callback-url.sh"

for entry in \
  'https://frontend.example/admit|/admit' \
  'https://frontend.example:8443/register|/register' \
  'https://10.0.0.8/admit|/admit'; do
  value="${entry%%|*}"
  path="${entry#*|}"
  validate_callback_url "${value}" "${path}" || { echo "valid callback rejected: ${value}" >&2; exit 1; }
done

for value in \
  'https://frontend.example/admit?next=/admin' \
  'https://frontend.example/admit#token' \
  'https://user@frontend.example/admit' \
  'https://user:pass@frontend.example/register' \
  'https://localhost/admit' \
  'https://localhost:8443/register' \
  'https://127.0.0.1/admit' \
  'https://127.99.1.2/register' \
  'https://[::1]/admit' \
  'http://frontend.example/admit' \
  'https://frontend.example/other' \
  'https:///admit'; do
  if validate_callback_url "${value}" /admit || validate_callback_url "${value}" /register; then
    echo "invalid callback accepted: ${value}" >&2
    exit 1
  fi
done

validate_spa_origin_contract \
  'https://frontend.example' \
  'https://frontend.example/admit' \
  'https://frontend.example/register' || { echo "matching SPA origin rejected" >&2; exit 1; }

for origin in \
  '*' \
  'https://frontend.example,https://other.example' \
  'http://frontend.example' \
  'https://other.example' \
  'https://frontend.example/path' \
  'https://user@frontend.example'; do
  if validate_spa_origin_contract \
    "${origin}" \
    'https://frontend.example/admit' \
    'https://frontend.example/register'; then
    echo "invalid or mismatched ALLOW_ORIGIN accepted: ${origin}" >&2
    exit 1
  fi
done

echo "callback URL validation tests passed"
