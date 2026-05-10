#!/usr/bin/env bash

set -Eeuo pipefail

IMAGE_URL="${IMAGE_URL:-https://fastly.mirror.pkgbuild.com/images/latest/Arch-Linux-x86_64-cloudimg.qcow2}"
IMAGE_NAME="${IMAGE_NAME:-Arch-Linux-x86_64-cloudimg.qcow2}"
INSTALLER_URL="${INSTALLER_URL:-https://raw.githubusercontent.com/masloffvs/iscan/refs/heads/main/installer.sh}"
INSTALLER_REPO_SLUG="${INSTALLER_REPO_SLUG:-masloffvs/iscan}"
INSTALLER_RELEASE_TAG="${INSTALLER_RELEASE_TAG:-latest}"
INSTALLER_RELEASE_FILE="${INSTALLER_RELEASE_FILE:-iscan-linux-x64.tar.gz}"
GUEST_INSTALL_TYPE="${GUEST_INSTALL_TYPE:-vdi}"
GUEST_WEB_SERVICE_NAME="${GUEST_WEB_SERVICE_NAME:-iscan-web.service}"
GUEST_VMSERVER_SERVICE_NAME="${GUEST_VMSERVER_SERVICE_NAME:-iscan-vmserver.service}"
WORK_IMAGE_SIZE="${WORK_IMAGE_SIZE:-12G}"
TMP_ROOT="${TMP_ROOT:-${TMPDIR:-/tmp}}"
CACHE_DIR="${CACHE_DIR:-${TMP_ROOT%/}/iscan-arch-qcow-cache}"
OUTPUT_DIR="${OUTPUT_DIR:-$PWD}"
OUTPUT_PATH="${OUTPUT_PATH:-${OUTPUT_DIR%/}/${IMAGE_NAME}}"
FORCE_DOWNLOAD="${FORCE_DOWNLOAD:-0}"
KEEP_WORK_DIR="${KEEP_WORK_DIR:-0}"
USE_SUDO_FOR_VIRT="${USE_SUDO_FOR_VIRT:-0}"
NO_SELINUX_RELABEL="${NO_SELINUX_RELABEL:-1}"
VIRT_CUSTOMIZE_DEBUG="${VIRT_CUSTOMIZE_DEBUG:-0}"
GUEST_TRACE="${GUEST_TRACE:-1}"
GUEST_ROOT_PASSWORD="${GUEST_ROOT_PASSWORD:-root}"

export LIBGUESTFS_BACKEND="${LIBGUESTFS_BACKEND:-direct}"

work_dir=""
cached_image_path="${CACHE_DIR%/}/${IMAGE_NAME}"

log() {
  printf '[build-arch-qcow] %s\n' "$*"
}

die() {
  printf '[build-arch-qcow] error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ "$KEEP_WORK_DIR" == "1" ]]; then
    return
  fi

  if [[ -n "$work_dir" && -d "$work_dir" ]]; then
    rm -rf "$work_dir"
  fi
}

trap cleanup EXIT

run_root() {
  if [[ "$USE_SUDO_FOR_VIRT" != "1" || ${EUID} -eq 0 ]]; then
    "$@"
    return
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    die "sudo is required to run virt-customize on this host"
  fi

  sudo -E "$@"
}

require_commands() {
  local command_name
  for command_name in cp curl dirname install mkdir mktemp qemu-img virt-customize; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      die "required command '$command_name' was not found"
    fi
  done
}

prepare_libguestfs_host() {
  if [[ ! -r /etc/os-release ]]; then
    return
  fi

  # shellcheck disable=SC1091
  . /etc/os-release

  if [[ "${ID:-}" != "ubuntu" && "${ID_LIKE:-}" != *ubuntu* ]]; then
    return
  fi

  shopt -s nullglob
  local kernel_paths=(/boot/vmlinuz*)
  shopt -u nullglob

  if [[ ${#kernel_paths[@]} -eq 0 ]]; then
    return
  fi

  log "Preparing libguestfs kernel permissions for Ubuntu host"
  run_root chmod 0644 "${kernel_paths[@]}"
}

download_clean_base_image() {
  mkdir -p "$CACHE_DIR"

  if [[ "$FORCE_DOWNLOAD" == "1" || ! -s "$cached_image_path" ]]; then
    local partial_path="${cached_image_path}.part"
    log "Downloading fresh base image into cache: $cached_image_path"
    rm -f "$partial_path"
    curl -fL "$IMAGE_URL" -o "$partial_path"
    mv "$partial_path" "$cached_image_path"
  else
    log "Reusing cached base image: $cached_image_path"
  fi
}

main() {
  require_commands
  prepare_libguestfs_host
  download_clean_base_image

  work_dir="$(mktemp -d "${TMP_ROOT%/}/iscan-arch-qcow.XXXXXX")"
  mkdir -p "$OUTPUT_DIR"
  mkdir -p "$(dirname "$OUTPUT_PATH")"

  local work_image_path="${work_dir}/${IMAGE_NAME}"
  local guest_update_script
  local installer_url_quoted
  local installer_repo_slug_quoted
  local installer_release_tag_quoted
  local installer_release_file_quoted
  local guest_install_type_quoted
  local guest_web_service_name_quoted
  local guest_vmserver_service_name_quoted
  local guest_trace_quoted
  local guest_root_password_quoted

  printf -v installer_url_quoted '%q' "$INSTALLER_URL"
  printf -v installer_repo_slug_quoted '%q' "$INSTALLER_REPO_SLUG"
  printf -v installer_release_tag_quoted '%q' "$INSTALLER_RELEASE_TAG"
  printf -v installer_release_file_quoted '%q' "$INSTALLER_RELEASE_FILE"
  printf -v guest_install_type_quoted '%q' "$GUEST_INSTALL_TYPE"
  printf -v guest_web_service_name_quoted '%q' "$GUEST_WEB_SERVICE_NAME"
  printf -v guest_vmserver_service_name_quoted '%q' "$GUEST_VMSERVER_SERVICE_NAME"
  printf -v guest_trace_quoted '%q' "$GUEST_TRACE"
  printf -v guest_root_password_quoted '%q' "$GUEST_ROOT_PASSWORD"

  log "Creating fresh working copy from cached base image"
  cp --reflink=auto "$cached_image_path" "$work_image_path"

  log "Growing working image to $WORK_IMAGE_SIZE"
  qemu-img resize "$work_image_path" "$WORK_IMAGE_SIZE" >/dev/null

  log "Customizing Arch image"
  guest_update_script=$'set -Eeuo pipefail\n'
  guest_update_script+=$'PS4="+ [guest:${LINENO}] "\n'
  guest_update_script+=$'log_step() { printf "[guest] %s\\n" "$1"; }\n'
  guest_update_script+="INSTALLER_URL=${installer_url_quoted}"$'\n'
  guest_update_script+="REPO_SLUG=${installer_repo_slug_quoted}"$'\n'
  guest_update_script+="RELEASE_TAG=${installer_release_tag_quoted}"$'\n'
  guest_update_script+="RELEASE_FILE=${installer_release_file_quoted}"$'\n'
  guest_update_script+="INSTALL_TYPE=${guest_install_type_quoted}"$'\n'
  guest_update_script+="WEB_SERVICE_NAME=${guest_web_service_name_quoted}"$'\n'
  guest_update_script+="VMSERVER_SERVICE_NAME=${guest_vmserver_service_name_quoted}"$'\n'
  guest_update_script+="GUEST_TRACE=${guest_trace_quoted}"$'\n'
  guest_update_script+="ROOT_PASSWORD=${guest_root_password_quoted}"$'\n'
  guest_update_script+=$'INSTALLER_PATH=/tmp/iscan-installer.sh\n'
  guest_update_script+=$'if [ "$GUEST_TRACE" = "1" ]; then set -x; fi\n'
  guest_update_script+=$'log_step "Repairing guest stdio device links"\n'
  guest_update_script+=$'rm -f /dev/stdin /dev/stdout /dev/stderr\n'
  guest_update_script+=$'ln -sf /proc/self/fd/0 /dev/stdin\n'
  guest_update_script+=$'ln -sf /proc/self/fd/1 /dev/stdout\n'
  guest_update_script+=$'ln -sf /proc/self/fd/2 /dev/stderr\n'
  guest_update_script+=$'log_step "Growing root partition"\n'
  guest_update_script+=$'growpart /dev/sda 3\n'
  guest_update_script+=$'log_step "Resizing btrfs root filesystem"\n'
  guest_update_script+=$'btrfs filesystem resize max /\n'
  guest_update_script+=$'log_step "Initializing pacman keyring"\n'
  guest_update_script+=$'pacman-key --init\n'
  guest_update_script+=$'log_step "Populating Arch pacman keyring"\n'
  guest_update_script+=$'pacman-key --populate archlinux\n'
  guest_update_script+=$'log_step "Downloading installer"\n'
  guest_update_script+=$'curl -fsSL "$INSTALLER_URL" -o "$INSTALLER_PATH"\n'
  guest_update_script+=$'chmod +x "$INSTALLER_PATH"\n'
  guest_update_script+=$'log_step "Running installer"\n'
  guest_update_script+=$'if [ "$GUEST_TRACE" = "1" ]; then\n'
  guest_update_script+=$'  REPO_SLUG="$REPO_SLUG" RELEASE_TAG="$RELEASE_TAG" RELEASE_FILE="$RELEASE_FILE" INSTALL_TYPE="$INSTALL_TYPE" WEB_SERVICE_NAME="$WEB_SERVICE_NAME" VMSERVER_SERVICE_NAME="$VMSERVER_SERVICE_NAME" bash -x "$INSTALLER_PATH"\n'
  guest_update_script+=$'else\n'
  guest_update_script+=$'  REPO_SLUG="$REPO_SLUG" RELEASE_TAG="$RELEASE_TAG" RELEASE_FILE="$RELEASE_FILE" INSTALL_TYPE="$INSTALL_TYPE" WEB_SERVICE_NAME="$WEB_SERVICE_NAME" VMSERVER_SERVICE_NAME="$VMSERVER_SERVICE_NAME" bash "$INSTALLER_PATH"\n'
  guest_update_script+=$'fi\n'
  guest_update_script+=$'log_step "Setting root password and unlocking root account"\n'
  guest_update_script+=$'printf "root:%s\\n" "$ROOT_PASSWORD" | chpasswd\n'
  guest_update_script+=$'passwd -u root >/dev/null 2>&1 || true\n'
  guest_update_script+=$'if [ "$INSTALL_TYPE" = "vdi" ]; then\n'
  guest_update_script+=$'  log_step "Enabling VDI services"\n'
  guest_update_script+=$'  mkdir -p /etc/systemd/system/multi-user.target.wants\n'
  guest_update_script+=$'  ln -sf "../$VMSERVER_SERVICE_NAME" "/etc/systemd/system/multi-user.target.wants/$VMSERVER_SERVICE_NAME"\n'
  guest_update_script+=$'  ln -sf "../$WEB_SERVICE_NAME" "/etc/systemd/system/multi-user.target.wants/$WEB_SERVICE_NAME"\n'
  guest_update_script+=$'fi\n'
  guest_update_script+=$'log_step "Pinning QEMU root-disk drivers in mkinitcpio"\n'
  guest_update_script+=$'if [ -f /etc/mkinitcpio.conf ]; then\n'
  guest_update_script+=$'  sed -i \'/^HOOKS=/ s/ autodetect//g\' /etc/mkinitcpio.conf\n'
  guest_update_script+=$'  if grep -q "^MODULES=" /etc/mkinitcpio.conf; then\n'
  guest_update_script+=$'    sed -i \'s/^MODULES=.*/MODULES=(virtio_pci virtio_blk virtio_scsi sd_mod ahci btrfs)/\' /etc/mkinitcpio.conf\n'
  guest_update_script+=$'  else\n'
  guest_update_script+=$'    printf "%s\\n" "MODULES=(virtio_pci virtio_blk virtio_scsi sd_mod ahci btrfs)" >> /etc/mkinitcpio.conf\n'
  guest_update_script+=$'  fi\n'
  guest_update_script+=$'fi\n'
  guest_update_script+=$'if compgen -G "/usr/lib/modules/*/vmlinuz" >/dev/null; then\n'
  guest_update_script+=$'  log_step "Regenerating kernel artifacts via mkinitcpio helper"\n'
  guest_update_script+=$'  printf "%s\n" /usr/lib/modules/*/vmlinuz | /usr/share/libalpm/scripts/mkinitcpio install\n'
  guest_update_script+=$'  log_step "Rebuilding initramfs presets with pinned QEMU root-disk drivers"\n'
  guest_update_script+=$'  mkinitcpio -P\n'
  guest_update_script+=$'fi\n'
  guest_update_script+=$'if compgen -G "/boot/vmlinuz-*" >/dev/null; then\n'
  guest_update_script+=$'  log_step "Rebuilding GRUB configuration"\n'
  guest_update_script+=$'  grub-mkconfig -o /boot/grub/grub.cfg\n'
  guest_update_script+=$'else\n'
  guest_update_script+=$'  echo "Kernel artifacts were not generated under /boot; refusing to seal a non-bootable image." >&2\n'
  guest_update_script+=$'  exit 1\n'
  guest_update_script+=$'fi\n'
  guest_update_script+=$'log_step "Cleaning up guest installer artifacts"\n'
  guest_update_script+=$'rm -f "$INSTALLER_PATH"\n'
  guest_update_script+=$'gpgconf --kill all >/dev/null 2>&1 || true\n'
  guest_update_script+=$'pkill -9 -x gpg-agent >/dev/null 2>&1 || true\n'
  guest_update_script+=$'pkill -9 -x dirmngr >/dev/null 2>&1 || true\n'
  guest_update_script+=$'pkill -9 -x makepkg >/dev/null 2>&1 || true\n'
  guest_update_script+=$'pkill -9 -x mkinitcpio >/dev/null 2>&1 || true\n'
  guest_update_script+=$'pkill -9 -x depmod >/dev/null 2>&1 || true\n'
  guest_update_script+=$'sync\n'
  guest_update_script+=$'sleep 2\n'
  local virt_customize_args=(
    -a "$work_image_path"
    --run-command "$guest_update_script"
  )

  # Arch cloud images do not rely on SELinux, and relabel can fail during
  # appliance teardown on some hosts, so skip it unless explicitly re-enabled.
  if [[ "$NO_SELINUX_RELABEL" == "1" ]]; then
    virt_customize_args+=(--no-selinux-relabel)
  fi

  if [[ "$VIRT_CUSTOMIZE_DEBUG" == "1" ]]; then
    log "Enabling virt-customize debug output (-v -x)"
    virt_customize_args=(-v -x "${virt_customize_args[@]}")
  fi

  run_root virt-customize "${virt_customize_args[@]}"

  log "Writing finished image to $OUTPUT_PATH"
  install -m 0644 "$work_image_path" "$OUTPUT_PATH"

  if [[ "$KEEP_WORK_DIR" == "1" ]]; then
    log "Keeping work directory: $work_dir"
  fi

  log "Done"
}

main "$@"
