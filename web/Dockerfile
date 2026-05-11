# Build stage
FROM oven/bun:latest AS builder

WORKDIR /workspace

# Copy root package files
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy project files
COPY . .

# Build the web assets using Vite
RUN bun x vite build --config web/vite.config.ts --outDir web-dist

# Runtime stage: ultra-lightweight nginx
FROM nginx:alpine

# Copy built assets to nginx default public directory
COPY --from=builder /workspace/web/web-dist /usr/share/nginx/html

# SPA support: redirect all non-file requests to index.html for React routing
RUN echo 'server { \
    listen 80; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html; \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
