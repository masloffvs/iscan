# syntax=docker/dockerfile:1.7

FROM archlinux:latest AS system-base

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    DOCKER_HOST=unix:///var/run/docker.sock \
    XDG_RUNTIME_DIR=/tmp/runtime-iscan

RUN pacman -Syu --noconfirm --needed archlinux-keyring \
    && pacman -Scc --noconfirm

FROM system-base AS runtime-deps

RUN pacman -Syu --noconfirm --needed \
        arch-install-scripts \
        bash \
        bubblewrap \
        ca-certificates \
        curl \
        dbus \
        ffmpeg \
        dnsmasq \
        libpulse \
        libx11 \
        libxcomposite \
        libxcursor \
        libxi \
        libxkbcommon \
        libxrandr \
        libxrender \
        libxtst \
        nspr \
        nss \
        pipewire \
        pipewire-pulse \
        proxychains-ng \
        qemu-base \
        sqlite \
        tar \
        unzip \
        wireplumber \
        xorg-server-xvfb \
        xorg-xauth \
    && pacman -Scc --noconfirm \
    && rm -rf /var/cache/pacman/pkg/* /tmp/* /var/tmp/*

FROM runtime-deps AS build-base

ENV BUN_INSTALL=/root/.bun \
    PATH=/root/.bun/bin:${PATH}

RUN pacman -Syu --noconfirm --needed \
        base-devel \
        git \
        pkgconf \
    && pacman -Scc --noconfirm \
    && curl -fsSL https://bun.sh/install | bash \
    && rm -rf /var/cache/pacman/pkg/*

FROM build-base AS deps

WORKDIR /workspace

COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

FROM deps AS builder

WORKDIR /workspace

COPY . .

RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun build ./index.ts --compile --outfile iscan-bin

FROM runtime-deps AS runtime

WORKDIR /workspace

COPY --from=builder /workspace/iscan-bin       ./iscan
COPY --from=builder /workspace/config.yml      ./config.yml
COPY --from=builder /workspace/nginx           ./nginx
COPY --from=builder /workspace/scripts         ./scripts

COPY scripts/docker-entrypoint.sh /usr/local/bin/iscan-entrypoint

RUN chmod +x /usr/local/bin/iscan-entrypoint ./iscan \
    && mkdir -p /tmp/runtime-iscan \
    && chmod 0700 /tmp/runtime-iscan

ENTRYPOINT ["iscan-entrypoint"]
CMD ["./iscan"]