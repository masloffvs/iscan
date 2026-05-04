FROM archlinux:latest

ENV LANG=C.UTF-8 \
	LC_ALL=C.UTF-8 \
	XDG_RUNTIME_DIR=/tmp/runtime-iscan \
	BUN_INSTALL=/root/.bun \
	PATH=/root/.bun/bin:${PATH}

RUN pacman -Syu --noconfirm --needed \
	bash \
	base-devel \
	ca-certificates \
	curl \
	dbus \
	git \
	gtk3 \
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
	pkgconf \
	python \
	sqlite \
	unzip \
	xorg-xauth \
	&& pacman -Scc --noconfirm \
	&& curl -fsSL https://bun.sh/install | bash

WORKDIR /workspace

COPY package.json bun.lock ./
RUN bun install

COPY . .
COPY scripts/docker-entrypoint.sh /usr/local/bin/iscan-entrypoint

RUN chmod +x /usr/local/bin/iscan-entrypoint \
	&& mkdir -p /tmp/runtime-iscan

ENTRYPOINT ["iscan-entrypoint"]
CMD ["bun", "run", "index.ts"]