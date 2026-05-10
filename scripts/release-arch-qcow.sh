#!/usr/bin/env bash

set -Eeuo pipefail

REPO_SLUG="${REPO_SLUG:-masloffvs/iscan}"
RELEASE_TAG="${RELEASE_TAG:-latest}"
TMP_ROOT="${TMP_ROOT:-${TMPDIR:-/tmp}}"
ARTIFACT_DIR="${ARTIFACT_DIR:-}"
KEEP_ARTIFACTS="${KEEP_ARTIFACTS:-0}"
IMAGE_NAME="${IMAGE_NAME:-Arch-Linux-x86_64-cloudimg.qcow2}"
BUILD_SCRIPT="${BUILD_SCRIPT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/build-arch-qcow.sh}"
SKIP_UPLOAD="${SKIP_UPLOAD:-0}"

artifact_dir=""

log() {
  printf '[release-arch-qcow] %s\n' "$*"
}

die() {
  printf '[release-arch-qcow] error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ "$KEEP_ARTIFACTS" == "1" ]]; then
    return
  fi

  if [[ -n "$artifact_dir" && -d "$artifact_dir" ]]; then
    rm -rf "$artifact_dir"
  fi
}

trap cleanup EXIT

require_commands() {
  local command_name
  for command_name in sha256sum sha512sum; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      die "required command '$command_name' was not found"
    fi
  done

  if [[ "$SKIP_UPLOAD" != "1" ]] && ! command -v gh >/dev/null 2>&1; then
    die "required command 'gh' was not found"
  fi

  if [[ ! -x "$BUILD_SCRIPT" ]]; then
    die "build script is missing or not executable: $BUILD_SCRIPT"
  fi
}

ensure_release_exists() {
  if ! gh release view "$RELEASE_TAG" -R "$REPO_SLUG" >/dev/null 2>&1; then
    die "release '$RELEASE_TAG' was not found in $REPO_SLUG; create/update the release first"
  fi
}

ensure_gh_auth() {
  if ! gh auth status >/dev/null 2>&1; then
    die "gh is not authenticated; run 'gh auth login' first"
  fi
}

main() {
  require_commands
  if [[ "$SKIP_UPLOAD" != "1" ]]; then
    ensure_gh_auth
    ensure_release_exists
  fi

  if [[ -n "$ARTIFACT_DIR" ]]; then
    artifact_dir="$ARTIFACT_DIR"
    mkdir -p "$artifact_dir"
  else
    artifact_dir="$(mktemp -d "${TMP_ROOT%/}/iscan-arch-release.XXXXXX")"
  fi

  local image_path="${artifact_dir%/}/${IMAGE_NAME}"
  local sha256_path="${image_path}.sha256"
  local sha512_path="${image_path}.sha512"

  log "Building Arch qcow image into $artifact_dir"
  OUTPUT_DIR="$artifact_dir" OUTPUT_PATH="$image_path" "$BUILD_SCRIPT"

  log "Generating checksum files"
  sha256sum "$image_path" > "$sha256_path"
  sha512sum "$image_path" > "$sha512_path"

  if [[ "$SKIP_UPLOAD" == "1" ]]; then
    log "Skipping GitHub upload because SKIP_UPLOAD=1"
    log "Built artifacts:"
    log "  $image_path"
    log "  $sha256_path"
    log "  $sha512_path"
    return
  fi

  log "Uploading assets to GitHub release '$RELEASE_TAG'"
  gh release upload "$RELEASE_TAG" \
    "$image_path" \
    "$sha256_path" \
    "$sha512_path" \
    --clobber \
    -R "$REPO_SLUG"

  log "Uploaded:"
  log "  $image_path"
  log "  $sha256_path"
  log "  $sha512_path"

  if [[ "$KEEP_ARTIFACTS" == "1" ]]; then
    log "Keeping artifact directory: $artifact_dir"
  fi
}

main "$@"
