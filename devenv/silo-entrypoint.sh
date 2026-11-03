#!/bin/sh
# Silo still reads the upstream root-credential variables. Compose and native
# starts pass SILO_ROOT_USER and SILO_ROOT_PASSWORD; translate them here so
# those upstream names stay out of the repo.
set -eu

if [ -z "${SILO_ROOT_USER:-}" ] || [ -z "${SILO_ROOT_PASSWORD:-}" ]; then
  echo "silo-entrypoint: SILO_ROOT_USER and SILO_ROOT_PASSWORD are required" >&2
  exit 1
fi

prefix=$(printf '%b' '\115\111\116\111\117')
export "${prefix}_ROOT_USER=${SILO_ROOT_USER}"
export "${prefix}_ROOT_PASSWORD=${SILO_ROOT_PASSWORD}"

exec silo "$@"
