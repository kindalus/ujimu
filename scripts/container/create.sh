#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=./lib.sh
. "${SCRIPT_DIR}/lib.sh"

require_profile "$@"
ensure_host_dirs
ensure_network

if [ "${UJIMU_ALLOW_RECREATE:-false}" != "true" ] && container_exists; then
  echo "Container ${CONTAINER_NAME} already exists. Use deploy.sh to restart or redeploy.sh to replace it." >&2
  exit 1
fi

create_container
