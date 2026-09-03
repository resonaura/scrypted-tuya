# Tuya Camera Bridge — Changelog

## 2.0.1

- **Fix Docker container startup**: remove obsolete committed `tsconfig.build.tsbuildinfo` artifact that caused TypeScript compiler to skip generating `apps/server/dist/main.js` during container build.
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
