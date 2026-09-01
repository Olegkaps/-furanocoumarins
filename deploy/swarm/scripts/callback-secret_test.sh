#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/callback-url.sh"
source "${SCRIPT_DIR}/callback-secret.sh"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "${TEST_ROOT}"' EXIT

docker() {
  if [[ "$1 $2" == "secret inspect" ]]; then
    return 1
  fi
  if [[ "$1 $2" == "secret create" ]]; then
    printf '%s' "$4" >"${TEST_ROOT}/label"
    cp "$6" "${TEST_ROOT}/stored"
    return 0
  fi
  return 90
}

assert_rejected() {
  local name="$1"
  local data="$2"
  printf '%b' "${data}" >"${TEST_ROOT}/${name}.input"
  if normalize_callback_secret_file "${TEST_ROOT}/${name}.input" "${TEST_ROOT}/${name}.normalized" 2>/dev/null; then
    echo "invalid callback file accepted: ${name}" >&2
    exit 1
  fi
}

assert_rejected embedded-lf 'https://front.example\n/admit'
assert_rejected embedded-crlf 'https://front.example\r\n/admit\r\n'
assert_rejected multiple-lines 'https://front.example/admit\nhttps://front.example/register\n'
assert_rejected multiple-trailing 'https://front.example/admit\n\n'
assert_rejected nul-byte 'https://front.example/admit\000ignored'

for suffix in '\n' '\r\n'; do
  printf '%b' "https://front.example/admit${suffix}" >"${TEST_ROOT}/valid.input"
  normalize_callback_secret_file "${TEST_ROOT}/valid.input" "${TEST_ROOT}/valid.normalized"
  create_normalized_callback_secret auth_magic_callback_url "${TEST_ROOT}/valid.normalized" /admit >/dev/null
  printf '%s' 'https://front.example/admit' >"${TEST_ROOT}/expected"
  cmp "${TEST_ROOT}/expected" "${TEST_ROOT}/stored"
  [[ "$(<"${TEST_ROOT}/label")" == "furanocoumarins.callback-url=https://front.example/admit" ]] || {
    echo "stored callback bytes and label differ" >&2
    exit 1
  }
done

echo "callback secret file tests passed"
