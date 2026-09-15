#!/usr/bin/env bash
# Run before deploying the PostgreSQL-only stack. Back up both databases first.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
STACK_NAME="${STACK_NAME:-furanocoumarins}"
APP="${STACK_NAME}_go-auth"
CASSANDRA="${STACK_NAME}_cassandra"
POSTGRES="${STACK_NAME}_postgres"
JOB="${STACK_NAME}_migration-1"
WAIT_ATTEMPTS="${WAIT_ATTEMPTS:-1800}"
WAIT_INTERVAL="${WAIT_INTERVAL:-2}"
[[ "$WAIT_ATTEMPTS" =~ ^[1-9][0-9]*$ && "$WAIT_INTERVAL" =~ ^[0-9]+$ ]] || { echo 'Invalid wait limits' >&2; exit 1; }
fail() { echo "$*" >&2; exit 1; }
[[ "$(docker info --format '{{.Swarm.ControlAvailable}}')" == true ]] || fail 'Run on an active Swarm manager.'
NODE="$(docker info --format '{{.Swarm.NodeID}}')"
[[ "$(docker node inspect --format '{{.Spec.Availability}}' "$NODE")" == active ]] || fail 'This manager must accept tasks (availability active).'
for service in "$APP" "$CASSANDRA" "$POSTGRES"; do
  replicas="$(docker service inspect --format '{{if .Spec.Mode.Replicated}}{{.Spec.Mode.Replicated.Replicas}}{{end}}' "$service")"
  [[ "$replicas" =~ ^[0-9]+$ ]] || fail "$service must be an existing replicated service."
  if [[ "$service" != "$APP" && "$replicas" -eq 0 ]]; then fail "$service is stopped."; fi
done
for secret in postgres_user postgres_password postgres_db; do
  docker secret inspect "$secret" >/dev/null || fail "Missing existing secret: $secret"
done
# Join every source/target network, without attaching or modifying either database.
networks=''
for service in "$CASSANDRA" "$POSTGRES"; do
  service_networks="$(docker service inspect --format '{{range .Spec.TaskTemplate.Networks}}{{println .Target}}{{end}}' "$service")"
  [[ -n "$service_networks" ]] || fail "$service has no network reachable by a Swarm job."
  networks+="$service_networks"$'\n'
done
network_args=()
while IFS= read -r network; do
  [[ -n "$network" ]] || continue
  [[ "$(docker network inspect --format '{{.Driver}}' "$network")" == overlay ]] || fail 'Database networks must be Swarm overlay networks.'
  network_args+=(--network "$network")
done < <(printf '%s\n' "$networks" | sort -u)
[[ ${#network_args[@]} -gt 0 ]] || fail 'No database network found.'
docker service inspect "$JOB" >/dev/null 2>&1 && fail "$JOB already exists. Inspect its tasks/logs before removing it and retrying."
echo 'Building standalone migration image; deployed services are untouched.'
IMAGE_FILE="$(mktemp)"
trap 'rm -f "$IMAGE_FILE"' EXIT
docker build --iidfile "$IMAGE_FILE" -f "$ROOT_DIR/backend/admin/Dockerfile.migration" "$ROOT_DIR/backend/admin"
IMAGE="$(<"$IMAGE_FILE")"
[[ "$IMAGE" =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'Build did not return an immutable image ID.'
owned=false
writer_stopped=false
finished=false
active_tasks() {
  local states
  states="$(docker service ps --no-trunc --format '{{.CurrentState}}' "$1")" || return 1
  # Do not filter DesiredState: a task marked for shutdown may still be running.
  printf '%s\n' "$states" | grep -Ev '^(Shutdown|Complete|Failed|Rejected|Remove)( |$)|^$' || true
}
wait_stopped() {
  local active
  for ((attempt=0; attempt<WAIT_ATTEMPTS; attempt++)); do
    active="$(active_tasks "$1")" || return 1
    [[ -z "$active" ]] && return 0
    sleep "$WAIT_INTERVAL"
  done
  return 1
}
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  rm -f "$IMAGE_FILE"
  if [[ "$owned" == true && "$finished" != true ]]; then
    echo "Stopping $JOB; retaining tasks/logs for inspection." >&2
    if ! docker service scale --detach "$JOB=0" >/dev/null || ! wait_stopped "$JOB"; then
      echo "CRITICAL: could not verify $JOB stopped. Keep all writers stopped and inspect Swarm immediately." >&2
    fi
    docker service logs --raw "$JOB" >&2 || true
  fi
  if [[ "$writer_stopped" == true ]]; then
    echo "$APP remains STOPPED. Deploy the new stack only after successful migration verification." >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# An atomic, zero-replica reservation prevents concurrent invocations from touching writers.
docker service create --name "$JOB" --replicas 0 --restart-condition none \
  --constraint "node.id==$NODE" --no-resolve-image "${network_args[@]}" \
  --secret postgres_user --secret postgres_password --secret postgres_db \
  --env "FURANO_CASSANDRA_HOST=$CASSANDRA" --env "PG_HOST=$POSTGRES" \
  --env PG_PORT=5432 --env PG_SSLMODE=disable \
  --env PG_USER_FILE=/run/secrets/postgres_user \
  --env PG_PASSWORD_FILE=/run/secrets/postgres_password \
  --env PG_DB_FILE=/run/secrets/postgres_db "$IMAGE" >/dev/null
owned=true
writer_stopped=true
docker service scale --detach "$APP=0" >/dev/null
wait_stopped "$APP" || fail 'Cannot verify all application writers stopped; migration was not started.'
docker service scale --detach "$JOB=1" >/dev/null
for ((attempt=0; attempt<WAIT_ATTEMPTS; attempt++)); do
  states="$(docker service ps --no-trunc --format '{{.CurrentState}}' "$JOB")"
  case "$states" in
    Complete\ *)
      docker service logs --raw "$JOB"
      finished=true
      echo "Migration complete. Inspect with: docker service ps --no-trunc $JOB"
      echo "After verification, remove only the job with: docker service rm $JOB"
      exit 0 ;;
    Failed\ *|Rejected\ *|Shutdown\ *) fail "Migration failed: $states" ;;
  esac
  sleep "$WAIT_INTERVAL"
done
fail 'Migration timed out.'
