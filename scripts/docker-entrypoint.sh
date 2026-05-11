#!/usr/bin/env bash
set -euo pipefail

workspace_dir="${ISCAN_WORKSPACE_DIR:-/workspace}"
runtime_cwd="${ISCAN_RUNTIME_CWD:-$PWD}"

cd "$workspace_dir"

mkdir -p /tmp/runtime-iscan
chmod 700 /tmp/runtime-iscan
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-iscan}"

if [[ -S /var/run/docker.sock ]]; then
	export DOCKER_HOST="${DOCKER_HOST:-unix:///var/run/docker.sock}"
fi

cd "$runtime_cwd"

exec "$@"