#!/bin/bash
# Fallback entry when bashio is absent (local docker test).
set -euo pipefail

export TUYA_BRIDGE_ROOT="${TUYA_BRIDGE_ROOT:-/app}"
export PYTHONPATH="${TUYA_BRIDGE_ROOT}/src${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONUNBUFFERED=1
export XDG_DATA_HOME="${XDG_DATA_HOME:-/data}"
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-/config}"
export PATH="/app/bin:${PATH}"

mkdir -p "${XDG_DATA_HOME}/bridge" "${XDG_CONFIG_HOME}/bridge"
cd "${XDG_DATA_HOME}/bridge"

echo "Tuya RTSP Bridge starting (API :8787, RTSP :8554)"

exec python3 -u "${TUYA_BRIDGE_ROOT}/src/server.py"
