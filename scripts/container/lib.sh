#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
PODMAN=${PODMAN:-podman}
UJIMU_IMAGE=${UJIMU_IMAGE:-localhost/ujimu:latest}
UJIMU_NETWORK=${UJIMU_NETWORK:-ujimu}
CONTAINER_PORT=${UJIMU_CONTAINER_PORT:-3000}

usage() {
  echo "Usage: $0 prod|test" >&2
  exit 2
}

require_profile() {
  if [ "$#" -ne 1 ]; then
    usage
  fi

  case "$1" in
    prod)
      PROFILE=prod
      CONTAINER_NAME=${UJIMU_CONTAINER_NAME:-ujimu-prod}
      HOST_PORT=${UJIMU_HOST_PORT:-3000}
      DEFAULT_ENV_FILE="${REPO_ROOT}/config/container/prod.env"
      DEFAULT_PI_DIR=/srv/ujimu/prod/pi
      DEFAULT_DATA_DIR=/srv/ujimu/prod/data
      ;;
    test)
      PROFILE=test
      CONTAINER_NAME=${UJIMU_CONTAINER_NAME:-ujimu-test}
      HOST_PORT=${UJIMU_HOST_PORT:-3001}
      DEFAULT_ENV_FILE="${REPO_ROOT}/config/container/test.env"
      DEFAULT_PI_DIR=/srv/ujimu/test/pi
      DEFAULT_DATA_DIR=/srv/ujimu/test/data
      ;;
    *)
      usage
      ;;
  esac

  ENV_FILE=${UJIMU_ENV_FILE:-$DEFAULT_ENV_FILE}
  load_env_file
  UJIMU_HOST_PI_DIR=${UJIMU_HOST_PI_DIR:-$DEFAULT_PI_DIR}
  UJIMU_HOST_DATA_DIR=${UJIMU_HOST_DATA_DIR:-$DEFAULT_DATA_DIR}
}

load_env_file() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "Environment file not found: $ENV_FILE" >&2
    echo "Copy config/container/${PROFILE}.env.example to $ENV_FILE or set UJIMU_ENV_FILE." >&2
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
}

ensure_host_dirs() {
  mkdir -p "$UJIMU_HOST_PI_DIR" "$UJIMU_HOST_DATA_DIR"
}

ensure_network() {
  if ! "$PODMAN" network exists "$UJIMU_NETWORK"; then
    "$PODMAN" network create "$UJIMU_NETWORK"
  fi
}

container_exists() {
  "$PODMAN" container exists "$CONTAINER_NAME"
}

create_container() {
  "$PODMAN" create \
    --name "$CONTAINER_NAME" \
    --network "$UJIMU_NETWORK" \
    --env-file "$ENV_FILE" \
    -p "${HOST_PORT}:${CONTAINER_PORT}" \
    -v "${UJIMU_HOST_PI_DIR}:/home/ujimu/.pi:Z" \
    -v "${UJIMU_HOST_DATA_DIR}:/home/ujimu/.local/share/ujimu:Z" \
    "$UJIMU_IMAGE"
}
