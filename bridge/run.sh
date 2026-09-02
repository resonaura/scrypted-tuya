#!/usr/bin/env bash
set -e

CONFIG_PATH="/data/options.json"

API_PORT=6766
WEB_PORT=6767
RTSP_PORT=8655
LOG_LEVEL="info"

if [ -f "$CONFIG_PATH" ]; then
  if command -v jq >/dev/null 2>&1; then
    USER_API_PORT=$(jq -r ".api_port // empty" "$CONFIG_PATH" 2>/dev/null)
    USER_WEB_PORT=$(jq -r ".web_port // empty" "$CONFIG_PATH" 2>/dev/null)
    USER_RTSP_PORT=$(jq -r ".rtsp_port // empty" "$CONFIG_PATH" 2>/dev/null)
    USER_LOG_LEVEL=$(jq -r ".log_level // empty" "$CONFIG_PATH" 2>/dev/null)

    [ -n "$USER_API_PORT" ] && [ "$USER_API_PORT" != "null" ] && API_PORT="$USER_API_PORT"
    [ -n "$USER_WEB_PORT" ] && [ "$USER_WEB_PORT" != "null" ] && WEB_PORT="$USER_WEB_PORT"
    [ -n "$USER_RTSP_PORT" ] && [ "$USER_RTSP_PORT" != "null" ] && RTSP_PORT="$USER_RTSP_PORT"
    [ -n "$USER_LOG_LEVEL" ] && [ "$USER_LOG_LEVEL" != "null" ] && LOG_LEVEL="$USER_LOG_LEVEL"
  fi
fi

API_PORT="${PORT:-$API_PORT}"
WEB_PORT="${WEB_PORT:-$WEB_PORT}"
RTSP_PORT="${RTSP_BASE_PORT:-$RTSP_PORT}"

export PORT="$API_PORT"
export WEB_PORT="$WEB_PORT"
export RTSP_BASE_PORT="$RTSP_PORT"
export NODE_ENV="production"
export SQLITE_PATH="/data/tuya-bridge/storage.sqlite"
export NATIVE_BIN_PATH="/app/bin/tuya-streamer"

mkdir -p /data/tuya-bridge /data/frames /config/tuya-bridge

echo "============================================================"
echo " Starting Tuya RTSP & P2P Media Bridge (Host Mode)"
echo "📡 Backend API Port:  $API_PORT"
echo "🌐 Frontend Web Port: $WEB_PORT (served via serve)"
echo "📹 RTSP Base Port:    $RTSP_PORT"
echo "============================================================"

cleanup() {
  echo "Received shutdown signal. Stopping all services..."
  kill $(jobs -p) 2>/dev/null || true
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# 1. Start Backend Server
cd /app/apps/server
node dist/main.js &
SERVER_PID=$!

# 2. Start Frontend Web Server via serve with SPA mode (-s) on $WEB_PORT
if [ -d "/app/apps/web/dist" ]; then
  serve -s /app/apps/web/dist -l "$WEB_PORT" &
  SERVE_PID=$!
fi

wait -n $SERVER_PID ${SERVE_PID:-$SERVER_PID}
