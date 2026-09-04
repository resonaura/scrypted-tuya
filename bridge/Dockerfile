# syntax=docker/dockerfile:1

# Global ARGs must be declared before any FROM to be usable in FROM instructions.
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

# Stage 2: Build Web Frontend & NestJS Backend (includes better-sqlite3 native compilation)
FROM node:22-bookworm-slim AS node-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 \
    && rm -rf /var/lib/apt/lists/*
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

# Deploy isolated production runtime for @tuya-bridge/server
RUN pnpm --filter @tuya-bridge/server --legacy --prod deploy /build/deployed-server

# Stage 3: Final Production Runtime
ARG BUILD_FROM
FROM ${BUILD_FROM}

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates libstdc++6 jq \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g serve \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built native binary
COPY --from=native-builder /src/build/tuya-streamer /app/bin/tuya-streamer
RUN chmod +x /app/bin/tuya-streamer

# Copy deployed standalone production server (includes production node_modules with compiled better-sqlite3)
COPY --from=node-builder /build/deployed-server/node_modules ./node_modules
COPY --from=node-builder /build/deployed-server/package.json ./package.json

# Copy built app dists
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
