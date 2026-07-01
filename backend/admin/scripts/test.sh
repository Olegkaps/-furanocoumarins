#!/usr/bin/env sh
set -eu

export ENV_TYPE="${ENV_TYPE:-TEST}"

echo "Running unit tests..."
go test ./... -coverprofile=coverage.out "$@"

echo "Checking business-logic coverage (application + domain)..."
go test ./internal/application/... ./internal/domain/... -coverprofile=business.out
coverage="$(go tool cover -func=business.out | awk '/^total:/ {print $3}' | tr -d '%')"
echo "Business logic coverage: ${coverage}%"

min_coverage=95
if [ "$(printf '%.0f' "$coverage")" -lt "$min_coverage" ]; then
  echo "Business logic coverage ${coverage}% is below ${min_coverage}%"
  exit 1
fi

echo "Running postgres integration tests (optional)..."
if [ "${RUN_INTEGRATION:-0}" = "1" ]; then
  go test -tags=integration ./internal/infrastructure/persistence/postgres/... -v
else
  echo "Skipped integration tests. Set RUN_INTEGRATION=1 to enable."
fi
