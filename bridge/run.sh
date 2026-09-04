#!/usr/bin/env bash
set -Eeuo pipefail

CONFIG_PATH="/data/options.json"
API_PORT=6766
WEB_PORT=6767
RTSP_PORT=8655
LOG_LEVEL=info

if [[ -f "$CONFIG_PATH" ]]; then
  API_PORT="$(jq -r '.api_port // 6766' "$CONFIG_PATH")"
  WEB_PORT="$(jq -r '.web_port // 6767' "$CONFIG_PATH")"
  RTSP_PORT="$(jq -r '.rtsp_port // 8655' "$CONFIG_PATH")"
  LOG_LEVEL="$(jq -r '.log_level // "info"' "$CONFIG_PATH")"
fi

# Resolve host IP from HA Supervisor API (available in all HAOS add-ons)
RTSP_HOST=""
if [[ -n "${SUPERVISOR_TOKEN:-}" ]]; then
  RTSP_HOST="$(curl -sf -H "Authorization: Bearer $SUPERVISOR_TOKEN" \
    http://supervisor/network/interface/default/info \
    | jq -r '.data.ipv4.address[0] // empty' \
    | cut -d'/' -f1 || true)"
fi
# Fallback: use hostname if Supervisor API unavailable
if [[ -z "$RTSP_HOST" ]]; then
  RTSP_HOST="$(hostname -I | awk '{print $1}' || true)"
fi

export PORT="${PORT:-$API_PORT}"
export WEB_PORT="${WEB_PORT:-$WEB_PORT}"
export RTSP_BASE_PORT="${RTSP_BASE_PORT:-$RTSP_PORT}"
export RTSP_HOST="${RTSP_HOST:-}"
export LOG_LEVEL="${LOG_LEVEL:-info}"
export NODE_ENV=production
export SQLITE_PATH=/data/tuya-bridge/storage.sqlite
export NATIVE_BIN_PATH=/app/bin/tuya-streamer

mkdir -p /data/tuya-bridge /data/frames /config/tuya-bridge

pids=()
shutdown() {
  trap - SIGINT SIGTERM EXIT
  for pid in "${pids[@]:-}"; do kill -TERM "$pid" 2>/dev/null || true; done
  local deadline=$((SECONDS + 8))
  while (( SECONDS < deadline )); do
    local alive=0
    for pid in "${pids[@]:-}"; do kill -0 "$pid" 2>/dev/null && alive=1; done
    (( alive == 0 )) && break
    sleep 0.1
  done
  for pid in "${pids[@]:-}"; do kill -KILL "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap shutdown SIGINT SIGTERM EXIT

node /app/apps/server/dist/main.js &
pids+=("$!")
serve -s /app/apps/web/dist -l "$WEB_PORT" --no-clipboard &
pids+=("$!")

set +e
wait -n "${pids[@]}"
status=$?
set -e
exit "$status"
