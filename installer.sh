#!/usr/bin/env bash

set -Eeuo pipefail

umask 022

REPO_SLUG="${REPO_SLUG:-masloffvs/iscan}"
RELEASE_TAG="${RELEASE_TAG:-latest}"
RELEASE_FILE="${RELEASE_FILE:-iscan-linux-x64.tar.gz}"
ARCHIVE_URL="${ARCHIVE_URL:-https://github.com/${REPO_SLUG}/releases/download/${RELEASE_TAG}/${RELEASE_FILE}}"

INSTALL_TYPE="${INSTALL_TYPE:-standard}"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/iscan}"
INSTALL_BIN_DIR="${INSTALL_BIN_DIR:-/usr/local/bin}"
STATE_DIR="${STATE_DIR:-/var/lib/iscan}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"

WEB_SERVICE_NAME="${WEB_SERVICE_NAME:-iscan-web.service}"
VMSERVER_SERVICE_NAME="${VMSERVER_SERVICE_NAME:-iscan-vmserver.service}"
XVFB_SERVICE_NAME="${XVFB_SERVICE_NAME:-iscan-xvfb.service}"
XVFB_DISPLAY="${XVFB_DISPLAY:-:99}"
XVFB_SCREEN="${XVFB_SCREEN:-1920x1080x24}"

COMMON_PACKAGES=(
  arch-install-scripts
  base-devel
  bash
  bubblewrap
  ca-certificates
  curl
  dbus
  ffmpeg
  git
  gtk3
  libpulse
  libx11
  libxcomposite
  libxcursor
  libxi
  libxkbcommon
  libxrandr
  libxrender
  libxtst
  mesa
  nspr
  nss
  pipewire
  pipewire-pulse
  proxychains-ng
  qemu-base
  sqlite
  tar
  unzip
  wireplumber
  xorg-xauth
)

VDI_PACKAGES=(
  qemu-desktop
  systemd
  xorg-server-xvfb
)

tmp_dir=""

log() {
  printf '[installer] %s\n' "$*"
}

warn() {
  printf '[installer] warning: %s\n' "$*" >&2
}

die() {
  printf '[installer] error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$tmp_dir" && -d "$tmp_dir" ]]; then
    rm -rf "$tmp_dir"
  fi
}

trap cleanup EXIT

run_root() {
  if [[ ${EUID} -eq 0 ]]; then
    "$@"
    return
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    die "This installer needs root privileges. Re-run as root or install sudo first."
  fi

  sudo "$@"
}

require_linux_host() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    die "This installer only supports Linux hosts."
  fi

  case "$(uname -m)" in
    x86_64|amd64)
      ;;
    *)
      die "Only x86_64 builds are currently published."
      ;;
  esac
}

require_arch_linux() {
  if [[ ! -r /etc/os-release ]]; then
    die "Cannot read /etc/os-release to detect the host distribution."
  fi

  # shellcheck disable=SC1091
  . /etc/os-release

  local distro_fingerprint="${ID:-} ${ID_LIKE:-}"
  if [[ "$distro_fingerprint" != *arch* ]]; then
    die "This installer currently supports Arch Linux hosts only because it relies on pacman package names and system layout."
  fi
}

validate_install_type() {
  case "$INSTALL_TYPE" in
    standard|vdi)
      ;;
    *)
      die "Unsupported INSTALL_TYPE='$INSTALL_TYPE'. Use 'standard' or 'vdi'."
      ;;
  esac
}

require_pacman() {
  if ! command -v pacman >/dev/null 2>&1; then
    die "pacman was not found in PATH. This script is intended for Arch Linux hosts only."
  fi
}

install_packages() {
  local packages=("${COMMON_PACKAGES[@]}")
  if [[ "$INSTALL_TYPE" == "vdi" ]]; then
    packages+=("${VDI_PACKAGES[@]}")
  fi

  log "Installing required Arch packages with pacman..."
  run_root pacman -Syu --noconfirm --needed "${packages[@]}"
}

verify_required_commands() {
  local commands=(
    bwrap
    curl
    ffmpeg
    git
    pacstrap
    pactl
    proxychains4
    qemu-img
    qemu-system-x86_64
    tar
  )

  local command_name
  for command_name in "${commands[@]}"; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      die "Expected command '$command_name' is still missing after package installation."
    fi
  done

  if [[ "$INSTALL_TYPE" == "vdi" && ! -x /usr/bin/systemctl ]]; then
    die "systemctl is required for INSTALL_TYPE=vdi but is not available."
  fi

  if [[ "$INSTALL_TYPE" == "vdi" && ! -x /usr/bin/Xvfb ]]; then
    die "Xvfb is required for INSTALL_TYPE=vdi but is not available."
  fi
}

download_release_archive() {
  local archive_path="$1"

  log "Downloading release bundle from ${ARCHIVE_URL}..."
  curl --fail --show-error --location --retry 3 --retry-all-errors "$ARCHIVE_URL" --output "$archive_path"
}

install_release_bundle() {
  local archive_path="$1"
  local preserved_config_path="$tmp_dir/config.yml"

  run_root install -d -m 0755 "$INSTALL_ROOT"
  run_root install -d -m 0755 "$STATE_DIR"

  if run_root test -f "$INSTALL_ROOT/config.yml"; then
    log "Preserving the existing config.yml from ${INSTALL_ROOT}."
    run_root cp "$INSTALL_ROOT/config.yml" "$preserved_config_path"
  fi

  log "Installing release files into ${INSTALL_ROOT}..."
  run_root rm -rf "$INSTALL_ROOT/iscan" "$INSTALL_ROOT/web-build" "$INSTALL_ROOT/README.md"
  run_root tar -xzf "$archive_path" -C "$INSTALL_ROOT"
  run_root chmod 0755 "$INSTALL_ROOT/iscan"

  if [[ -f "$preserved_config_path" ]]; then
    run_root install -m 0644 "$preserved_config_path" "$INSTALL_ROOT/config.yml"
  fi

  run_root install -d -m 0755 "$STATE_DIR/data" "$STATE_DIR/.iscan"
}

write_launcher() {
  local launcher_path="$tmp_dir/iscan-launcher"

  cat >"$launcher_path" <<EOF
#!/usr/bin/env bash

set -Eeuo pipefail

install_root="${INSTALL_ROOT}"
binary_path="${INSTALL_ROOT}/iscan"
default_root_state_dir="${STATE_DIR}"

if [[ ! -x "\$binary_path" ]]; then
  printf 'iscan launcher error: %s is missing or not executable.\n' "\$binary_path" >&2
  exit 1
fi

if [[ -n "\${ISCAN_WORKDIR:-}" ]]; then
  workdir="\${ISCAN_WORKDIR}"
elif [[ "\$(id -u)" -eq 0 ]]; then
  workdir="\$default_root_state_dir"
else
  workdir="\${XDG_STATE_HOME:-\$HOME/.local/state}/iscan"
fi

mkdir -p "\$workdir" "\$workdir/data" "\$workdir/.iscan"
cd "\$workdir"

exec "\$binary_path" "\$@"
EOF

  run_root install -d -m 0755 "$INSTALL_BIN_DIR"
  run_root install -m 0755 "$launcher_path" "$INSTALL_BIN_DIR/iscan"
}

write_vdi_service_units() {
  local xvfb_unit_path="$tmp_dir/$XVFB_SERVICE_NAME"
  local vmserver_unit_path="$tmp_dir/$VMSERVER_SERVICE_NAME"
  local web_unit_path="$tmp_dir/$WEB_SERVICE_NAME"

  cat >"$xvfb_unit_path" <<EOF
[Unit]
Description=iscan virtual X server
After=local-fs.target

[Service]
Type=simple
WorkingDirectory=${STATE_DIR}
ExecStart=/usr/bin/Xvfb ${XVFB_DISPLAY} -screen 0 ${XVFB_SCREEN} -nolisten tcp -ac -noreset
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

  cat >"$vmserver_unit_path" <<EOF
[Unit]
Description=iscan VM server
After=network-online.target ${XVFB_SERVICE_NAME}
Wants=network-online.target ${XVFB_SERVICE_NAME}
Requires=${XVFB_SERVICE_NAME}

[Service]
Type=simple
Environment=ISCAN_WORKDIR=${STATE_DIR}
Environment=DISPLAY=${XVFB_DISPLAY}
WorkingDirectory=${STATE_DIR}
ExecStart=${INSTALL_BIN_DIR}/iscan --vmserver
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

  cat >"$web_unit_path" <<EOF
[Unit]
Description=iscan web interface
After=network-online.target ${VMSERVER_SERVICE_NAME}
Wants=network-online.target ${VMSERVER_SERVICE_NAME}

[Service]
Type=simple
Environment=ISCAN_WORKDIR=${STATE_DIR}
WorkingDirectory=${STATE_DIR}
ExecStart=${INSTALL_BIN_DIR}/iscan --web
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

  run_root install -d -m 0755 "$SYSTEMD_DIR"
  run_root install -m 0644 "$xvfb_unit_path" "$SYSTEMD_DIR/$XVFB_SERVICE_NAME"
  run_root install -m 0644 "$vmserver_unit_path" "$SYSTEMD_DIR/$VMSERVER_SERVICE_NAME"
  run_root install -m 0644 "$web_unit_path" "$SYSTEMD_DIR/$WEB_SERVICE_NAME"

  if [[ -d /run/systemd/system ]] && command -v systemctl >/dev/null 2>&1; then
    log "Reloading systemd and enabling iscan services..."
    run_root systemctl daemon-reload
    run_root systemctl enable --now "$XVFB_SERVICE_NAME" "$VMSERVER_SERVICE_NAME" "$WEB_SERVICE_NAME"
  else
    warn "systemd is not currently active. Unit files were written, but services were not enabled automatically."
  fi
}

print_summary() {
  log "iscan installation completed."
  log "  install root : ${INSTALL_ROOT}"
  log "  launcher     : ${INSTALL_BIN_DIR}/iscan"
  log "  state dir    : ${STATE_DIR}"

  if [[ "$INSTALL_TYPE" == "vdi" ]]; then
    log "  xvfb service : ${XVFB_SERVICE_NAME}"
    log "  web service  : ${WEB_SERVICE_NAME}"
    log "  vm service   : ${VMSERVER_SERVICE_NAME}"
    log "  xvfb display : ${XVFB_DISPLAY} (${XVFB_SCREEN})"
    log "  web url      : http://127.0.0.1:8086"
    log "  vm api       : http://127.0.0.1:36665"
  else
    log "Run 'iscan --help' to inspect available modes."
  fi

  if ! command -v paru >/dev/null 2>&1; then
    warn "paru is not installed from the official Arch repositories. Install it manually if you need AUR helper workflows."
  fi
}

main() {
  require_linux_host
  require_arch_linux
  validate_install_type
  require_pacman

  tmp_dir="$(mktemp -d -t iscan-installer.XXXXXX)"
  local archive_path="$tmp_dir/$RELEASE_FILE"

  install_packages
  verify_required_commands
  download_release_archive "$archive_path"
  install_release_bundle "$archive_path"
  write_launcher

  if [[ "$INSTALL_TYPE" == "vdi" ]]; then
    write_vdi_service_units
  fi

  print_summary
}

main "$@"