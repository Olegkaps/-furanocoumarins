#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
source "${ROOT_DIR}/deploy/swarm/scripts/image-reference.sh"

fail() {
  echo "image-reference test failed: $*" >&2
  exit 1
}

for reference in \
  "postgres:17.6" \
  "registry.example.test/auth-master:v1.2.3" \
  "registry.example.test/team/furan-backend:2026-09-06" \
  "registry.example.test:5000/team/furan-import:release_7" \
  "registry.example.test/auth-master@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
do
  is_pinned_image_reference "${reference}" || fail "valid pinned reference was rejected: ${reference}"
done

for reference in \
  "" \
  "postgres" \
  "registry.example.test/auth-master:latest" \
  "registry.example.test/auth-master:LATEST" \
  "registry.example.test/auth-master:" \
  "registry.example.test/auth-master@sha256:too-short" \
  "Registry.Example.Test/auth-master:v1.2.3" \
  "registry.example.test/auth-master:bad/tag"
do
  if is_pinned_image_reference "${reference}"; then
    fail "unsafe or malformed reference was accepted: ${reference:-<empty>}"
  fi
done

echo "production image-reference tests passed"
