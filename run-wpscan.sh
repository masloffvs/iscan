#!/bin/bash
mkdir -p "./data/container-wpscan/home"
exec bwrap \
  --ro-bind "./data/container-wpscan" / \
  --dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --bind "./data/container-wpscan/home" /root \
  --ro-bind /etc/resolv.conf /etc/resolv.conf \
  --unshare-all \
  --share-net \
  --hostname "wpscan-box" \
  /bin/bash
