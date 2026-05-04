#!/usr/bin/env bash
set -euo pipefail

cd /workspace

mkdir -p /tmp/runtime-iscan
chmod 700 /tmp/runtime-iscan
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-iscan}"

if [[ ! -d node_modules ]] || [[ ! -f node_modules/.iscan-bun-lock ]] || ! cmp -s bun.lock node_modules/.iscan-bun-lock; then
	echo "[docker] Installing Bun dependencies..."
	bun install
	mkdir -p node_modules
	cp bun.lock node_modules/.iscan-bun-lock
fi

exec "$@"