#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=./lib.sh
. "${SCRIPT_DIR}/lib.sh"

require_profile "$@"

"${SCRIPT_DIR}/build.sh"

if container_exists; then
  "$PODMAN" stop "$CONTAINER_NAME" || true
  "$PODMAN" rm "$CONTAINER_NAME"
fi

UJIMU_ALLOW_RECREATE=true "${SCRIPT_DIR}/create.sh" "$PROFILE"
"$PODMAN" start "$CONTAINER_NAME"
