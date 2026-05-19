#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=./lib.sh
. "${SCRIPT_DIR}/lib.sh"

require_profile "$@"

if container_exists; then
  "$PODMAN" rm -f "$CONTAINER_NAME"
else
  echo "Container ${CONTAINER_NAME} does not exist."
fi
