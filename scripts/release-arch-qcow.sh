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
WORK_IMAGE_SIZE="${WORK_IMAGE_SIZE:-12G}"
GUEST_INSTALL_TYPE="${GUEST_INSTALL_TYPE:-vdi}"
GUEST_ROOT_LOGIN="${GUEST_ROOT_LOGIN:-root}"
GUEST_ROOT_PASSWORD="${GUEST_ROOT_PASSWORD:-root}"
GUEST_SERIAL_CONSOLE="${GUEST_SERIAL_CONSOLE:-ttyS0}"
GUEST_ROOT_FILESYSTEM="${GUEST_ROOT_FILESYSTEM:-btrfs}"

readonly RELEASE_DEFAULTS_NOTES_START='<!-- iscan-arch-qcow-defaults:start -->'
readonly RELEASE_DEFAULTS_NOTES_END='<!-- iscan-arch-qcow-defaults:end -->'

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

build_release_defaults_block() {
  cat <<EOF
${RELEASE_DEFAULTS_NOTES_START}
## Arch qcow defaults

- Artifact: ${IMAGE_NAME}
- Format: qcow2
- Install profile: ${GUEST_INSTALL_TYPE}
- Expanded disk size: ${WORK_IMAGE_SIZE}
- Default login: ${GUEST_ROOT_LOGIN}
- Default password: ${GUEST_ROOT_PASSWORD}
- Root filesystem: ${GUEST_ROOT_FILESYSTEM}
- Serial console: ${GUEST_SERIAL_CONSOLE}
${RELEASE_DEFAULTS_NOTES_END}
EOF
}

merge_release_notes() {
  local current_notes="$1"
  local defaults_block="$2"

  if [[ "$current_notes" == *"$RELEASE_DEFAULTS_NOTES_START"* && "$current_notes" == *"$RELEASE_DEFAULTS_NOTES_END"* ]]; then
    local prefix="${current_notes%%"$RELEASE_DEFAULTS_NOTES_START"*}"
    local suffix="${current_notes#*"$RELEASE_DEFAULTS_NOTES_END"}"
    printf '%s%s%s' "$prefix" "$defaults_block" "$suffix"
    return
  fi

  if [[ -n "$current_notes" ]]; then
    printf '%s\n\n%s' "$current_notes" "$defaults_block"
    return
  fi

  printf '%s' "$defaults_block"
}

update_release_notes() {
  local current_notes
  local merged_notes
  local defaults_block
  local notes_path="${artifact_dir%/}/release-notes.md"

  current_notes="$(gh release view "$RELEASE_TAG" -R "$REPO_SLUG" --json body --jq '.body // ""')"
  defaults_block="$(build_release_defaults_block)"
  merged_notes="$(merge_release_notes "$current_notes" "$defaults_block")"

  printf '%s\n' "$merged_notes" > "$notes_path"

  log "Updating GitHub release notes with qcow defaults"
  gh release edit "$RELEASE_TAG" --notes-file "$notes_path" -R "$REPO_SLUG" >/dev/null
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
    log "Release defaults:"
    while IFS= read -r line; do
      log "  $line"
    done < <(build_release_defaults_block)
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

  update_release_notes

  if [[ "$KEEP_ARTIFACTS" == "1" ]]; then
    log "Keeping artifact directory: $artifact_dir"
  fi
}

main "$@"
