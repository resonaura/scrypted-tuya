# syntax=docker/dockerfile:1

# Global ARGs must be declared before any FROM to be usable in FROM instructions.
# BUILD_FROM can be passed explicitly (e.g. by HA supervisor) or defaults to amd64.
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-debian:bookworm

# Stage 1: Build C++ Native Streaming Engine
FROM debian:bookworm-slim AS native-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git ca-certificates \
    libssl-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY apps/native ./
RUN mkdir -p build \
    && cd build \
    && cmake -DCMAKE_BUILD_TYPE=Release \
             -DOPENSSL_ROOT_DIR=/usr \
             .. \
    && make -j$(nproc)

# Stage 2: Build Web Frontend & NestJS Backend
FROM node:22-bookworm-slim AS node-builder
RUN npm install -g pnpm@10.5.2
WORKDIR /build

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY apps/server ./apps/server
COPY apps/web ./apps/web

RUN pnpm --filter @tuya-bridge/web build
RUN pnpm --filter @tuya-bridge/server build

# Stage 3: Final Production Runtime
# Re-declare ARG so it is in scope for this stage's FROM
ARG BUILD_FROM
FROM ${BUILD_FROM}

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates libstdc++6 jq \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g pnpm@10.5.2 serve \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built native binary
COPY --from=native-builder /src/build/tuya-streamer /app/bin/tuya-streamer
RUN chmod +x /app/bin/tuya-streamer

# Install production server dependencies (server only; web is static)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --prod --filter @tuya-bridge/server

# Copy built artefacts from builder
COPY --from=node-builder /build/apps/server/dist ./apps/server/dist
COPY --from=node-builder /build/apps/web/dist ./apps/web/dist

COPY run.sh /run.sh
RUN chmod +x /run.sh \
    && mkdir -p /data/tuya-bridge /data/frames /config/tuya-bridge

ENV NODE_ENV=production \
    PORT=6766 \
    WEB_PORT=6767 \
    RTSP_BASE_PORT=8655 \
    SQLITE_PATH=/data/tuya-bridge/storage.sqlite \
    NATIVE_BIN_PATH=/app/bin/tuya-streamer \
    PATH="/app/bin:${PATH}"

EXPOSE 6766 6767 8655
WORKDIR /app
CMD ["/run.sh"]
