# Stage 1: Base image with runtime dependencies
FROM archlinux:latest AS base

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    DOCKER_HOST=unix:///var/run/docker.sock \
    XDG_RUNTIME_DIR=/tmp/runtime-iscan \
    BUN_INSTALL=/root/.bun \
    PATH=/root/.bun/bin:${PATH}

RUN pacman -Syu --noconfirm --needed \
    arch-install-scripts \
    bash \
    bubblewrap \
    ca-certificates \
    curl \
    dbus \
    ffmpeg \
    dnsmasq \
    docker \
    docker-buildx \
    docker-compose \
    git \
    gtk3 \
    libpulse \
    libx11 \
    libxcomposite \
    libxcursor \
    libxi \
    libxkbcommon \
    libxrandr \
    libxrender \
    libxtst \
    mesa \
    nspr \
    nss \
    pipewire \
    pipewire-pulse \
    pkgconf \
    python \
    proxychains-ng \
    qemu-base \
    qemu-desktop \
    sqlite \
    tar \
    unzip \
    wireplumber \
    xorg-server-xvfb \
    xorg-xauth \
    && pacman -Scc --noconfirm \
    && curl -fsSL https://bun.sh/install | bash

# Stage 2: Builder for node_modules and web assets
FROM base AS builder

RUN pacman -S --noconfirm --needed base-devel

WORKDIR /workspace
COPY package.json bun.lock ./
RUN bun install

COPY . .
RUN bun run build

# Stage 3: Final runtime image
FROM base AS runtime

WORKDIR /workspace

# Copy only what's needed for runtime
COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/dist/ ./
COPY --from=builder /workspace/nginx ./nginx
COPY --from=builder /workspace/scripts ./scripts

COPY scripts/docker-entrypoint.sh /usr/local/bin/iscan-entrypoint
RUN chmod +x /usr/local/bin/iscan-entrypoint \
    && mkdir -p /tmp/runtime-iscan

ENTRYPOINT ["iscan-entrypoint"]
CMD ["bun", "run", "index.ts"]
