#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
read -r -a compose <<< "${COMPOSE:-docker compose}"
project="furano-monitoring-smoke-$$"
args=(-p "$project" -f monitoring/tests/compose.smoke.yaml)
cleanup() { "${compose[@]}" "${args[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT
"${compose[@]}" "${args[@]}" up -d fixture nginxlog-exporter nginx prometheus alertmanager grafana
if ! "${compose[@]}" "${args[@]}" run --rm check; then
  "${compose[@]}" "${args[@]}" logs --tail=60 nginx nginxlog-exporter prometheus grafana
  echo 'FAIL: isolated monitoring pipeline smoke' >&2
  exit 1
fi
echo 'PASS: isolated monitoring pipeline smoke (no production resources)'
