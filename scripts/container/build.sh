#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=./lib.sh
. "${SCRIPT_DIR}/lib.sh"

cd "$REPO_ROOT"
"$PODMAN" build --format docker -t "$UJIMU_IMAGE" .
