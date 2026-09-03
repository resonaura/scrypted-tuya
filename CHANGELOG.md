# Changelog

## 2.0.0

### Scrypted Plugin

- Bump to stable `2.0.0` — no longer beta.
- Full end-to-end testing and validation completed.
- Improved Smart Life P2P HD RTSP integration via the companion Tuya Camera Bridge add-on.
- Stream options correctly declare `codec: "hevc"`, `audio: { codec: "pcm_alaw" }`, `prebuffer: 4000`, and `oobCodecParameters: false`.
- Quality selection requests the highest advertised writable quality enum (`hd`, `2k`, `4k`, etc.) before RTSP allocation, with safe fallback.

### Tuya Camera Bridge (Home Assistant Add-on)

Complete rewrite of the bridge add-on. The legacy Go/Python engine (originally based on **[DanEng1982/tuya-rtsp-bridge](https://github.com/DanEng1982/tuya-rtsp-bridge)**, to whom we are grateful) has been replaced with:

- **Custom C++ RTSP engine** (`tuya-streamer`):
  - Full RTSP/1.0 SDP compliance — `a=range:npt=0-`, `Content-Base`, complete `RTP-Info` with `seq`/`rtptime` anchors → VLC clock ticks correctly.
  - Per-client monotonic RTP timestamp normalization via `std::chrono::steady_clock` — no more backward-jumping timestamps.
  - Cached IDR/GOP priming → instant decode on connect.
  - HEVC (H.265) and H.264; G.711 PCMU and AAC audio.
- **NestJS + Fastify backend** for camera management and Tuya QR-login flow.
- **React + HeroUI frontend** with:
  - Live RTSP preview with play-on-hover overlay.
  - Add-camera modal with themed QR code (foreground-only, less-rounded dots).
  - Auto-open modal when no profiles exist.
  - Snapshot age display, camera status, RTSP link copy.
- Ports: `6766` (API), `6767` (Web UI / ingress), `8655+` (RTSP per camera).

---

## 0.1.2-beta

- Accurately declare `codec: "hevc"`, `audio: { codec: "pcm_alaw" }`, `prebuffer: 4000`, and `oobCodecParameters: false` in `getVideoStreamOptions`.
- Enables Scrypted stream router to automatically trigger the H.264 / AAC transcoding pipeline for HomeKit HAP compliance.

## 0.1.1-beta

- Tuya RTSP Bridge port 8600 default across full stack.
- Smart Life P2P HD RTSP stream integration with online auto-status, dynamic UI naming, and unconstrained HEVC/H.264 FFmpeg negotiation for Rebroadcast and snapshots.

## 0.1.0-beta.17

- Initialize `online: true` in `TuyaCamera` constructor when P2P RTSP URL is configured.
- Remove hardcoded `codec: "h264"` constraint in `getVideoStreamOptions`.

## 0.1.0-beta.16

- Set stream display name to `Smart Life P2P HD` dynamically when P2P RTSP is configured.
- Bypass Tuya Cloud offline check when P2P RTSP URL is present.

## 0.1.0-beta.10

- Add per-camera Smart Life P2P HD RTSP override.
- Add Home Assistant add-on based on DanEng1982/tuya-rtsp-bridge v1.2.4.

## 0.1.0-beta.9

- Request highest recognised writable quality advertised by camera schema before RTSP allocation.
- Safe fallback to Tuya's server-selected quality.

## 0.0.1

- Initial Tuya camera plugin extraction from Scrypted monorepo.
- Camera discovery, cloud RTSP streaming, doorbell events, motion detection.
