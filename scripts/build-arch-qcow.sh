#!/usr/bin/env bash

set -Eeuo pipefail

IMAGE_URL="${IMAGE_URL:-https://fastly.mirror.pkgbuild.com/images/latest/Arch-Linux-x86_64-cloudimg.qcow2}"
IMAGE_NAME="${IMAGE_NAME:-Arch-Linux-x86_64-cloudimg.qcow2}"

export LIBGUESTFS_BACKEND="${LIBGUESTFS_BACKEND:-direct}"

curl -fL "$IMAGE_URL" -o "$IMAGE_NAME"

virt-customize -a "$IMAGE_NAME" \
  --run-command 'pacman-key --init' \
  --run-command 'pacman-key --populate archlinux' \
  --run-command 'pacman -Syu --noconfirm'
