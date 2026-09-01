# Home Assistant Supervisor builds with context = this directory only.
# Pull app sources from GitHub at build time (or override REPO_REF).
# syntax=docker/dockerfile:1

ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-debian:bookworm
ARG REPO_URL=https://github.com/DanEng1982/tuya-rtsp-bridge.git
ARG REPO_REF=v1.2.4

FROM golang:1.23-bookworm AS engine
ARG REPO_URL
ARG REPO_REF
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --depth 1 --branch "${REPO_REF}" "${REPO_URL}" repo \
    && cd repo/vendor/tuya-ipc-terminal \
    && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/tuya-ipc-terminal .

FROM ${BUILD_FROM}
ARG REPO_URL
ARG REPO_REF

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl ffmpeg git python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN git clone --depth 1 --branch "${REPO_REF}" "${REPO_URL}" /tmp/repo \
    && cp /tmp/repo/requirements-docker.txt /app/requirements-docker.txt \
    && cp -a /tmp/repo/src /app/src \
    && cp -a /tmp/repo/web /app/web \
    && rm -rf /tmp/repo

RUN pip3 install --break-system-packages --no-cache-dir -r /app/requirements-docker.txt \
    || pip3 install --no-cache-dir -r /app/requirements-docker.txt

COPY --from=engine /out/tuya-ipc-terminal /app/bin/tuya-ipc-terminal
COPY run.sh /run.sh
RUN chmod 755 /app/bin/tuya-ipc-terminal /run.sh \
    && mkdir -p /data/tuya-rtsp-bridge /config/tuya-rtsp-bridge

ENV TUYA_BRIDGE_ROOT=/app \
    PYTHONPATH=/app/src \
    PYTHONUNBUFFERED=1 \
    XDG_DATA_HOME=/data \
    XDG_CONFIG_HOME=/config \
    PATH="/app/bin:${PATH}"

EXPOSE 8787 8554
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/api/state', timeout=3).read()" || exit 1
WORKDIR /data/tuya-rtsp-bridge
CMD ["/run.sh"]
