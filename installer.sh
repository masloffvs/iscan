#!/usr/bin/env bash

set -Eeuo pipefail

umask 022

REPO_SLUG="${REPO_SLUG:-masloffvs/iscan}"
DOCKER_REGISTRY="${DOCKER_REGISTRY:-ghcr.io}"
DOCKER_IMAGE_REPOSITORY="${DOCKER_IMAGE_REPOSITORY:-${REPO_SLUG}}"
DOCKER_TAG="${DOCKER_TAG:-latest}"
DOCKER_IMAGE="${DOCKER_IMAGE:-${DOCKER_REGISTRY}/${DOCKER_IMAGE_REPOSITORY}:${DOCKER_TAG}}"

INSTALL_TYPE="${INSTALL_TYPE:-docker}"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/iscan}"
INSTALL_BIN_DIR="${INSTALL_BIN_DIR:-/usr/local/bin}"
STATE_DIR="${STATE_DIR:-/var/lib/iscan}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
COMPOSE_FILE_NAME="${COMPOSE_FILE_NAME:-docker-compose.yml}"
WEB_PORT="${WEB_PORT:-8086}"
VMSERVER_PORT="${VMSERVER_PORT:-36665}"
CONTAINER_WORKDIR="${CONTAINER_WORKDIR:-/var/lib/iscan}"
CONTAINER_DISPLAY="${CONTAINER_DISPLAY:-:99}"
CONTAINER_RUNTIME_DIR="${CONTAINER_RUNTIME_DIR:-/tmp/runtime-iscan}"
XVFB_SCREEN="${XVFB_SCREEN:-1920x1080x24}"

COMMON_PACKAGES=(
  bash
  ca-certificates
  curl
  docker
  docker-buildx
  docker-compose
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
    docker)
      ;;
    standard|vdi)
      warn "INSTALL_TYPE=${INSTALL_TYPE} is deprecated. The installer now deploys the Docker stack instead."
      INSTALL_TYPE="docker"
      ;;
    *)
      die "Unsupported INSTALL_TYPE='$INSTALL_TYPE'. Only 'docker' is supported."
      ;;
  esac
}

require_pacman() {
  if ! command -v pacman >/dev/null 2>&1; then
    die "pacman was not found in PATH. This script is intended for Arch Linux hosts only."
  fi
}

install_packages() {
  log "Installing required Arch packages with pacman..."
  run_root pacman -Syu --noconfirm --needed "${COMMON_PACKAGES[@]}"
}

verify_required_commands() {
  local commands=(
    curl
    docker
  )

  local command_name
  for command_name in "${commands[@]}"; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      die "Expected command '$command_name' is still missing after package installation."
    fi
  done

  if ! docker compose version >/dev/null 2>&1; then
    die "Docker Compose is not available via 'docker compose'."
  fi

  if [[ -d /run/systemd/system ]] && ! command -v systemctl >/dev/null 2>&1; then
    die "systemctl is expected on this host but is not available."
  fi
}

ensure_docker_runtime() {
  if run_root docker info >/dev/null 2>&1; then
    return
  fi

  if [[ -d /run/systemd/system ]] && command -v systemctl >/dev/null 2>&1; then
    log "Enabling and starting Docker..."
    run_root systemctl enable --now docker
  fi

  if ! run_root docker info >/dev/null 2>&1; then
    die "Docker daemon is not reachable after installation. Start it manually and rerun the installer."
  fi
}

write_default_config() {
  local config_path="$STATE_DIR/config.yml"
  if run_root test -f "$config_path"; then
    log "Preserving the existing config.yml from ${STATE_DIR}."
    return
  fi

  log "Writing bootstrap config.yml into ${STATE_DIR}..."
  cat >"$tmp_dir/config.yml" <<'EOF'
services:
  hunter:
    AUTH_METHOD: bearer
    API_KEY: CHANGEME
    BEARER_TOKEN: CHANGEME
  storage:
    DATABASE_URL: "data/iscan.db"
  portScan:
    ALLOW_HOSTS: ["*"]
    DENY_HOSTS: []
    ALLOW_PRIVATE_ADDRESSES: true
    ALLOW_LOOPBACK: true
    DENY_PUBLIC_ADDRESSES: false
  exploitdb:
    LIST_URL: "https://www.exploit-db.com/"
    RAW_URL_TEMPLATE: "https://www.exploit-db.com/raw/{id}"
    DOWNLOAD_URL_TEMPLATE: "https://www.exploit-db.com/download/{id}"
    REFRESH_INTERVAL_MS: 86400000
    REQUEST_TIMEOUT_MS: 15000
    PAGE_SIZE: 15
    RECENT_PAGE_WINDOW: 8
    BACKFILL_PAGE_BUDGET: 64
    RAW_FETCH_CONCURRENCY: 4
    REFRESH_ON_EMPTY: true
    BACKFILL_ON_EMPTY: true
  ua:
    REFRESH_INTERVAL_MS: 86400000
    STALE_AFTER_MS: 86400000
    REFRESH_ON_EMPTY: true
    SOURCES:
      - ID: microlink
        KIND: microlink-json
        URL: "https://microlink.io/user-agents.json"
        ENABLED: true
        CATEGORIES: [user, crawler, ai]
        RECORD_KINDS: [exact]
      - ID: arcjet-well-known-bots
        KIND: arcjet-well-known-bots
        URL: "https://raw.githubusercontent.com/arcjet/well-known-bots/main/well-known-bots.json"
        ENABLED: true
        RECORD_KINDS: [exact, pattern]
      - ID: cloudflare-bot-directory
        KIND: cloudflare-bot-directory
        URL: "https://raw.githubusercontent.com/microlinkhq/cloudflare-bot-directory/master/src/index.json"
        ENABLED: true
        RECORD_KINDS: [exact, pattern]
      - ID: crawler-user-agents
        KIND: crawler-user-agents
        URL: "https://raw.githubusercontent.com/monperrus/crawler-user-agents/master/crawler-user-agents.json"
        ENABLED: true
        RECORD_KINDS: [exact, pattern]

runtime:
  backgroundWorkers:
    SMOL: true
    METRICS_INTERVAL_MS: 1000
    WATCH_REFRESH_MS: 1000
    LOG_RETENTION:
      MAX_ENTRIES_PER_WORKER: 5000
    RESOURCE_LIMITS:
      MAX_YOUNG_GENERATION_SIZE_MB: 16
      MAX_OLD_GENERATION_SIZE_MB: 128
      CODE_RANGE_SIZE_MB: 64
      STACK_SIZE_MB: 8

manifest:
  dependencies:
    proxychains:
      binary: proxychains4
      aliases:
        - proxychains
      required: true
      description: Proxy wrapper used before launching qemu.
    qemu-system:
      binary: qemu-system-x86_64
      required: true
      description: QEMU system emulator used to run virtual machines.
    qemu-img:
      binary: qemu-img
      required: true
      description: QEMU disk image utility.
  kits:
    qemu:
      architecture: x86_64
      machine: q35
      accelerator: kvm
      memoryMb: 2048
      useProxy: false
      autoBootstrapRouterOnLaunch: false
      systemDependencyId: qemu-system
      imageDependencyId: qemu-img
      proxyDependencyId: proxychains
      defaultArgs: []
EOF

  run_root install -m 0644 "$tmp_dir/config.yml" "$config_path"
}

prepare_install_layout() {
  run_root install -d -m 0755 "$INSTALL_ROOT"
  run_root install -d -m 0755 "$STATE_DIR"
  run_root install -d -m 0755 "$STATE_DIR/data" "$STATE_DIR/.iscan"
}

write_compose_file() {
  local compose_path="$INSTALL_ROOT/$COMPOSE_FILE_NAME"

  cat >"$tmp_dir/$COMPOSE_FILE_NAME" <<EOF
x-iscan-base: &iscan-base
  image: ${DOCKER_IMAGE}
  privileged: true
  working_dir: ${CONTAINER_WORKDIR}
  environment:
    DISPLAY: ${CONTAINER_DISPLAY}
    DOCKER_HOST: unix:///var/run/docker.sock
    ISCAN_RUNTIME_CWD: ${CONTAINER_WORKDIR}
    XDG_RUNTIME_DIR: ${CONTAINER_RUNTIME_DIR}
  volumes:
    - ${STATE_DIR}:${CONTAINER_WORKDIR}
    - /var/run/docker.sock:/var/run/docker.sock
  restart: unless-stopped

services:
  iscan:
    <<: *iscan-base
    restart: "no"
    stdin_open: true
    tty: true
    command: ["bun", "/workspace/index.ts"]

  iscan-vmserver:
    <<: *iscan-base
    ports:
      - "127.0.0.1:${VMSERVER_PORT}:36665"
    command:
      - sh
      - -lc
      - |
        mkdir -p ${CONTAINER_RUNTIME_DIR}
        chmod 700 ${CONTAINER_RUNTIME_DIR}
        Xvfb ${CONTAINER_DISPLAY} -screen 0 ${XVFB_SCREEN} -nolisten tcp -ac -noreset >/tmp/iscan-xvfb.log 2>&1 &
        exec bun /workspace/index.ts --vmserver

  iscan-web:
    <<: *iscan-base
    depends_on:
      - iscan-vmserver
    ports:
      - "127.0.0.1:${WEB_PORT}:8086"
    command: ["bun", "/workspace/index.ts", "--web"]
EOF

  run_root install -m 0644 "$tmp_dir/$COMPOSE_FILE_NAME" "$compose_path"
}

pull_and_start_stack() {
  local compose_path="$INSTALL_ROOT/$COMPOSE_FILE_NAME"

  log "Pulling Docker image ${DOCKER_IMAGE}..."
  run_root docker compose -f "$compose_path" pull

  log "Starting iscan Docker services..."
  run_root docker compose -f "$compose_path" up -d iscan-vmserver iscan-web
}

write_management_unit() {
  local unit_path="$tmp_dir/iscan-docker.service"
  local compose_path="$INSTALL_ROOT/$COMPOSE_FILE_NAME"

  cat >"$unit_path" <<EOF
[Unit]
Description=iscan Docker stack
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${INSTALL_ROOT}
ExecStart=/usr/bin/docker compose -f ${compose_path} up -d iscan-vmserver iscan-web
ExecStop=/usr/bin/docker compose -f ${compose_path} down

[Install]
WantedBy=multi-user.target
EOF

  run_root install -d -m 0755 "$SYSTEMD_DIR"
  run_root install -m 0644 "$unit_path" "$SYSTEMD_DIR/iscan-docker.service"

  if [[ -d /run/systemd/system ]] && command -v systemctl >/dev/null 2>&1; then
    log "Reloading systemd and enabling iscan-docker.service..."
    run_root systemctl daemon-reload
    run_root systemctl enable --now iscan-docker.service
  else
    warn "systemd is not currently active. Docker containers were started, but iscan-docker.service was not enabled automatically."
  fi
}

write_launcher() {
  local launcher_path="$tmp_dir/iscan-launcher"
  local compose_path="$INSTALL_ROOT/$COMPOSE_FILE_NAME"

  cat >"$launcher_path" <<EOF
#!/usr/bin/env bash

set -Eeuo pipefail

compose_file="${compose_path}"

if [[ ! -f "\$compose_file" ]]; then
  printf 'iscan launcher error: %s is missing.\n' "\$compose_file" >&2
  exit 1
fi

docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1; then
    docker_cmd=(sudo docker)
  else
    printf 'iscan launcher error: docker daemon is not accessible and sudo is unavailable.\n' >&2
    exit 1
  fi
fi

if [[ \$# -gt 0 ]]; then
  case "\$1" in
    up|down|pull|ps|logs|restart|start|stop)
      exec "\${docker_cmd[@]}" compose -f "\$compose_file" "\$@"
      ;;
  esac
fi

exec "\${docker_cmd[@]}" compose -f "\$compose_file" run --rm iscan "\$@"
EOF

  run_root install -d -m 0755 "$INSTALL_BIN_DIR"
  run_root install -m 0755 "$launcher_path" "$INSTALL_BIN_DIR/iscan"
}

print_summary() {
  log "iscan installation completed."
  log "  image        : ${DOCKER_IMAGE}"
  log "  install root : ${INSTALL_ROOT}"
  log "  compose file : ${INSTALL_ROOT}/${COMPOSE_FILE_NAME}"
  log "  launcher     : ${INSTALL_BIN_DIR}/iscan"
  log "  state dir    : ${STATE_DIR}"
  log "  config       : ${STATE_DIR}/config.yml"
  log "  web url      : http://127.0.0.1:${WEB_PORT}"
  log "  vm api       : http://127.0.0.1:${VMSERVER_PORT}"
  warn "Edit ${STATE_DIR}/config.yml to replace placeholder Hunter credentials before serious use."
}

main() {
  require_linux_host
  require_arch_linux
  validate_install_type
  require_pacman

  tmp_dir="$(mktemp -d -t iscan-installer.XXXXXX)"

  install_packages
  verify_required_commands
  ensure_docker_runtime
  prepare_install_layout
  write_default_config
  write_compose_file
  write_launcher
  pull_and_start_stack
  write_management_unit

  print_summary
}

main "$@"