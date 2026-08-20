#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=./lib.sh
. "${SCRIPT_DIR}/lib.sh"

cd "$REPO_ROOT"

BUILD_ARGS=()
for name in UJIMU_LLM_WIKI_REPO UJIMU_LLM_WIKI_REF UJIMU_LLM_WIKI_SUBDIR; do
  if [ -n "${!name:-}" ]; then
    BUILD_ARGS+=(--build-arg "${name}=${!name}")
  fi
done

if [ "${#BUILD_ARGS[@]}" -gt 0 ]; then
  "$PODMAN" build --format docker "${BUILD_ARGS[@]}" -t "$UJIMU_IMAGE" .
else
  "$PODMAN" build --format docker -t "$UJIMU_IMAGE" .
fi
