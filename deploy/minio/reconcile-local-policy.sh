#!/bin/sh
set -eu

while :; do
  if mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" &&
    mc mb --ignore-existing local/pages &&
    mc anonymous set-json /policy/public-read.json local/pages; then
    sleep 15
  else
    sleep 1
  fi
done
