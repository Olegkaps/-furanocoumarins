#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
CONFIG_FILE="${ROOT_DIR}/deploy/swarm/production.conf"
CASSANDRA_IMAGE="cassandra:3.11.9"
source "${ROOT_DIR}/deploy/swarm/scripts/production-config.sh"

usage() {
  echo "Usage: $0 [--config FILE]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config)
      [[ $# -ge 2 ]] || { usage; exit 1; }
      CONFIG_FILE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

load_production_config "${CONFIG_FILE}"

if ! docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -qE 'active|manager'; then
  echo "Docker Swarm is not initialized. Run: docker swarm init" >&2
  exit 1
fi

SOURCE_VOLUME="${LEGACY_CASSANDRA_VOLUME}"
TARGET_VOLUME="${SWARM_CASSANDRA_VOLUME}"
MARKER_PATH="/.furanocoumarins-cassandra-migration-v1"

volume_exists() {
  docker volume inspect "$1" >/dev/null 2>&1
}

read_target_marker() {
  docker run --rm --user 0 \
    --mount "type=volume,src=${TARGET_VOLUME},dst=/target,readonly" \
    "${CASSANDRA_IMAGE}" sh -ec "cat /target${MARKER_PATH}" 2>/dev/null
}

target_is_complete() {
  local kind source_label marker
  kind="$(docker volume inspect --format '{{index .Labels "furanocoumarins.cassandra-volume"}}' "${TARGET_VOLUME}" 2>/dev/null || true)"
  source_label="$(docker volume inspect --format '{{index .Labels "furanocoumarins.cassandra-source"}}' "${TARGET_VOLUME}" 2>/dev/null || true)"
  [[ "${kind}" == "migration-v1" && "${source_label}" == "${SOURCE_VOLUME}" ]] || return 1
  marker="$(read_target_marker || true)"
  grep -Fxq 'version=1' <<<"${marker}" &&
    grep -Fxq "source=${SOURCE_VOLUME}" <<<"${marker}" &&
    grep -Eq '^manifest=sha256:[0-9a-f]{64}$' <<<"${marker}"
}

if ! volume_exists "${SOURCE_VOLUME}"; then
  echo "Legacy Cassandra volume '${SOURCE_VOLUME}' does not exist." >&2
  echo "If Compose used another project name, set LEGACY_CASSANDRA_VOLUME in production.conf." >&2
  exit 1
fi

legacy_cassandra_ids=()
while IFS= read -r container_id; do
  [[ -n "${container_id}" ]] && legacy_cassandra_ids+=("${container_id}")
done < <(docker ps --all --quiet --filter "volume=${SOURCE_VOLUME}")
if [[ "${#legacy_cassandra_ids[@]}" -gt 1 ]]; then
  echo "More than one legacy container mounts Cassandra volume '${SOURCE_VOLUME}'." >&2
  printf '  %s\n' "${legacy_cassandra_ids[@]}" >&2
  exit 1
fi
legacy_cassandra_id="${legacy_cassandra_ids[0]:-}"
legacy_compose_project=""
legacy_writer_ids=()
if [[ -n "${legacy_cassandra_id}" ]]; then
  detected_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/cassandra"}}{{.Name}}{{end}}{{end}}' "${legacy_cassandra_id}")"
  if [[ -z "${detected_volume}" ]]; then
    echo "The legacy Cassandra container has no named volume at /var/lib/cassandra." >&2
    exit 1
  fi
  if [[ "${detected_volume}" != "${SOURCE_VOLUME}" ]]; then
    echo "Legacy Cassandra uses '${detected_volume}', not configured '${SOURCE_VOLUME}'." >&2
    echo "Set LEGACY_CASSANDRA_VOLUME=${detected_volume} in production.conf and rerun." >&2
    exit 1
  fi
  legacy_compose_project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "${legacy_cassandra_id}" 2>/dev/null || true)"
  if [[ -n "${legacy_compose_project}" ]]; then
    while IFS= read -r container_id; do
      [[ -n "${container_id}" ]] && legacy_writer_ids+=("${container_id}")
    done < <(docker ps --quiet \
      --filter "label=com.docker.compose.project=${legacy_compose_project}" \
      --filter "label=com.docker.compose.service=go-auth")
  fi
fi
if volume_exists "${TARGET_VOLUME}"; then
  if target_is_complete; then
    echo "Cassandra volume migration is already complete: ${SOURCE_VOLUME} -> ${TARGET_VOLUME}"
    exit 0
  fi
  echo "Target volume '${TARGET_VOLUME}' already exists but has no valid completed-migration marker." >&2
  echo "Do not deploy it. Inspect or remove that target volume explicitly, then rerun this command." >&2
  exit 1
fi

container_is_running() {
  [[ "$(docker inspect --format '{{.State.Running}}' "$1" 2>/dev/null || true)" == "true" ]]
}

writer_was_running=false
cassandra_was_running=false
writer_stopped=false
cassandra_stopped=false
cassandra_drained=false
target_created=false
migration_complete=false

if [[ "${#legacy_writer_ids[@]}" -gt 0 ]]; then
  writer_was_running=true
fi
if [[ -n "${legacy_cassandra_id}" ]] && container_is_running "${legacy_cassandra_id}"; then
  cassandra_was_running=true
fi

restore_after_failure() {
  local status=$?
  local cassandra_ready=true
  if [[ "${migration_complete}" == true ]]; then
    return 0
  fi
  set +e
  if [[ "${target_created}" == true ]]; then
    if ! docker volume rm "${TARGET_VOLUME}" >/dev/null; then
      echo "Could not remove partial target '${TARGET_VOLUME}'; inspect it before rerunning." >&2
    fi
  fi
  if [[ "${cassandra_was_running}" == true && ( "${cassandra_drained}" == true || "${cassandra_stopped}" == true ) ]]; then
    cassandra_ready=false
    if docker start "${legacy_cassandra_id}" >/dev/null; then
      for _ in $(seq 1 60); do
        if docker exec "${legacy_cassandra_id}" cqlsh -e 'DESCRIBE CLUSTER' >/dev/null 2>&1; then
          cassandra_ready=true
          break
        fi
        sleep 2
      done
    fi
    if [[ "${cassandra_ready}" != true ]]; then
      echo "Legacy Cassandra did not recover; leaving the legacy writer stopped." >&2
    fi
  fi
  if [[ "${writer_stopped}" == true && "${writer_was_running}" == true ]]; then
    if [[ "${cassandra_was_running}" != true || "${cassandra_ready}" == true ]]; then
      docker start "${legacy_writer_ids[@]}" >/dev/null
    fi
  fi
  echo "Cassandra migration failed; legacy-service restoration and partial-target cleanup were attempted." >&2
  [[ "${status}" -ne 0 ]] || status=1
  exit "${status}"
}
trap restore_after_failure EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "${writer_was_running}" == true ]]; then
  echo "Stopping the legacy application writer..."
  writer_stopped=true
  docker stop "${legacy_writer_ids[@]}"
fi
if [[ "${cassandra_was_running}" == true ]]; then
  echo "Draining and stopping legacy Cassandra..."
  docker exec "${legacy_cassandra_id}" nodetool drain
  cassandra_drained=true
  cassandra_stopped=true
  docker stop "${legacy_cassandra_id}"
fi

mounted_by="$(docker ps --filter "volume=${SOURCE_VOLUME}" --format '{{.ID}} {{.Names}}')"
if [[ -n "${mounted_by}" ]]; then
  echo "Legacy Cassandra volume is still mounted by a running container:" >&2
  echo "${mounted_by}" >&2
  exit 1
fi

docker volume create \
  --label furanocoumarins.cassandra-volume=migration-v1 \
  --label "furanocoumarins.cassandra-source=${SOURCE_VOLUME}" \
  "${TARGET_VOLUME}" >/dev/null
target_created=true

echo "Copying and checksumming every Cassandra file. The source volume remains untouched..."
docker run --rm --user 0 \
  --mount "type=volume,src=${SOURCE_VOLUME},dst=/source,readonly" \
  --mount "type=volume,src=${TARGET_VOLUME},dst=/target" \
  "${CASSANDRA_IMAGE}" bash -euo pipefail -c '
    marker=".furanocoumarins-cassandra-migration-v1"
    source_name="$1"
    if [[ ! -d /source/data ]]; then
      echo "Source does not look like a Cassandra data directory: missing /source/data" >&2
      exit 20
    fi
    if find /target -mindepth 1 -print -quit | grep -q .; then
      echo "Target volume is not empty" >&2
      exit 21
    fi
    (cd /source && tar --numeric-owner -cpf - .) | (cd /target && tar --numeric-owner -xpf -)

    make_manifest() {
      local root="$1" output="$2"
      (
        cd "${root}"
        find . -mindepth 1 ! -path "./${marker}" -printf "%y\t%m\t%U\t%G\t%p\t%l\0" | LC_ALL=C sort -z
        printf "\n--FILE-CONTENTS--\n"
        find . -type f ! -path "./${marker}" -print0 | LC_ALL=C sort -z | xargs -0 sha256sum
      ) >"${output}"
    }

    make_manifest /source /tmp/source.manifest
    make_manifest /target /tmp/target.manifest
    if ! cmp -s /tmp/source.manifest /tmp/target.manifest; then
      echo "Source and target manifests differ after copy" >&2
      exit 22
    fi
    digest_line="$(sha256sum /tmp/source.manifest)"
    digest="${digest_line%% *}"
    printf "version=1\nsource=%s\nmanifest=sha256:%s\n" "${source_name}" "${digest}" >"/target/${marker}"
    chmod 0400 "/target/${marker}"
    sync
  ' _ "${SOURCE_VOLUME}"

migration_complete=true
trap - EXIT INT TERM
echo "Cassandra migration complete: ${SOURCE_VOLUME} -> ${TARGET_VOLUME}"
echo "The legacy volume was kept for rollback. Deploy the Swarm stack next."
