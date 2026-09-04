# Tuya Camera Bridge — Changelog

## 2.0.5

- **Fix H.264 RTSP relay 404 error & expose correct public stream URL**:
  - Migrate legacy `rtspPort=8554` DB entries to `RTSP_BASE_PORT` (8655) on startup (port 8554 is occupied by another service in HAOS environments, causing relay bind failure and HTTP 404 from ffmpeg DESCRIBE).
  - Changed `camera.entity.ts` default `rtspPort` from `8554` to `8655` to match `RTSP_BASE_PORT`.
  - Public RTSP URLs now show the actual host IP (resolved via HA Supervisor API in `run.sh`) instead of `127.0.0.1`.

## 2.0.4

- **Fix `spawn ffmpeg ENOENT` runtime error**:
  - Added `ffmpeg` package to the final production container (`Stage 3`), restoring live camera snapshots, card previews, and WebRTC-to-browser H.264 transcoding.

## 2.0.3

- **Fix build hang during Docker container creation (`pnpm prune --prod`)**:
  - Replaced runtime `pnpm prune --prod` step with `pnpm --filter @tuya-bridge/server --legacy --prod deploy` in the build stage.
  - Generates an isolated, production-only `node_modules` tree with prebuilt native `better-sqlite3` bindings during the build stage.
  - Removed `pnpm` from the final runtime container, dramatically speeding up and stabilizing container creation on ARM / Raspberry Pi.

## 2.0.2

- **Fix `better-sqlite3` native bindings loading (`Could not locate the bindings file`)**:
  - Registered `better-sqlite3` in `onlyBuiltDependencies` in `pnpm-workspace.yaml` to authorize native lifecycle compilation under pnpm v10.
  - Multi-stage Docker optimization: installed `build-essential` & `python3` in `node-builder`, compiled native `.node` addons, and copied prebuilt modules directly into production container with `pnpm prune --prod`.

## 2.0.1

- **Fix Docker container startup**:
  - Approve `better-sqlite3` native build via `onlyBuiltDependencies` in `pnpm-workspace.yaml`.
  - Add `build-essential` and `python3` to build stage and copy precompiled `node_modules` with native bindings directly into the runtime container.
  - Remove obsolete committed `tsconfig.build.tsbuildinfo` artifact that caused TypeScript compiler to skip generating `apps/server/dist/main.js` during container build.
- **Open Web UI in new tab**: replaced Home Assistant ingress with standard `webui` link (`http://[HOST]:[PORT:6767]`) to open the dashboard directly in a new browser tab instead of an iframe.
- **Fix compiler warnings**: resolved integer signedness comparison and missing struct field initializers in the native engine.

## 2.0.0

Complete rewrite of the bridge from the ground up.

### What's new

- **Custom C++ RTSP streaming engine** (`tuya-streamer`) replacing the old Go/Python stack entirely.
  - WebRTC P2P (Tuya/Smart Life protocol) to RTSP/TCP re-streaming.
  - Full RTSP/1.0 SDP compliance: `a=range:npt=0-`, `Content-Base`, and proper `RTP-Info` with `seq`/`rtptime` anchors — VLC playback clock now ticks correctly.
  - Per-client normalized RTP sequence and timestamp generation using `std::chrono::steady_clock` — eliminates backward-jumping timestamps.
  - Cached IDR/GOP priming for instant decode on connect without waiting for the next keyframe.
  - Automatic keyframe request on new RTSP client connection.
  - HEVC and H.264 support; G.711 PCMU and AAC audio.
- **NestJS + Fastify REST/WebSocket backend** for camera profile management and QR-login flow.
- **React + HeroUI web frontend** with live RTSP preview, add-camera modal with themed QR code (foreground-color, less-rounded dots), snapshot age indicator, and play-on-hover overlay.
- **Auto-open Add Profile modal** when no camera profiles exist on first load.

### Attribution

This release was inspired by the original work of **[DanEng1982](https://github.com/DanEng1982/tuya-rtsp-bridge)**. We are grateful for their pioneering effort on Tuya P2P bridging. The current engine, backend, and UI are a full from-scratch rewrite.

---

## 1.2.9 (legacy — DanEng1982 era)

- Switch default RTSP port from 8554 to 8600.
- Cleanly patch upstream sources during build and startup.

## 1.2.8

- Hardcode ports: 8787 (Web UI), 8600→8554 (RTSP).
- Fix Docker base image architecture parameterization.

## 1.2.7

- Remove ingress (port-forwarding does not work in add-on).
- Keep webui button to open the bridge Web UI directly.

## 1.2.6

- Add webui button for "Open Web UI" in HA add-on interface.
- Add icon.png for the add-on.

## 1.2.5

- Fix startup log command outside the Supervisor bashio shell.
- Add HTTP health check.

## 1.2.4

- Pin bridge backend to `DanEng1982/tuya-rtsp-bridge` v1.2.4.
