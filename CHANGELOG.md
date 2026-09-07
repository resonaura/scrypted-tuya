# Changelog

## 2.1.8

- **Periodic Audio Click Fix (RTCP Demuxing & Filtering)**:
  - Fixed recurring ~5-second audio pop/click caused by unhandled RTCP Sender Report (SR) control packets arriving on the camera WebRTC audio track without `RtcpReceivingSession` media handler.
  - Attached `rtc::RtcpReceivingSession` handler to `audio_send_track_` in `tuya-streamer`, ensuring RTCP control frames are processed by libdatachannel's RTCP engine rather than forwarded as raw RTP media.
  - Added strict RFC 5761 multiplexing validation in `handle_rtp_packet` (dropping RTCP PT ranges 64–95 and $\ge 192$) to protect downstream RTP queue and PCM audio pipelines from control packets.
  - Fixed audio timestamp anchoring and silenced synthetic silence loop after genuine audio packet arrival.

## 2.1.7

- **Camera Inbound Microphone Audio Stabilization**:
  - Overrode camera SDP Answer `a=recvonly` on `m=audio` to `a=sendrecv` in `tuya-streamer`, preventing WebRTC stacks from negotiating a send-only track and dropping microphone audio packets.
  - Aligned WebRTC SDP audio codec precedence (`PCMU/8000`, `PCMA/8000`, `L16`) with Tuya's native 16-bit linear PCM over PT 0.
  - Fixed `INT16_MIN` boundary handling in linear PCM to μ-law transcoding.
  - Unified version numbers across Scrypted plugin and Tuya Bridge monorepo.

## 2.1.6

- Small fixes

## 2.1.5

- **Talkback Zero-Latency Audio Push (`-flush_packets 1`)**:
  - Added `-flush_packets 1` to the talkback FFmpeg process in `camera.ts`, ensuring FLV audio packets are flushed over TCP to the RTMP endpoint immediately without waiting for output buffer thresholds.
- **Tuya Camera Bridge 2.1.4 Integration**:
  - **Camera Inbound Mic Audio**: Sent explicit `{"type":"start","msg":"audio"}` on the `fmp4Stream` DataChannel and restored bidirectional audio track reception in `tuya-streamer`, enabling live microphone audio from the camera.
  - **Transcoder CPU Optimization**: Upgraded embedded Bridge transcoder with optimized x264 parameters (`no-deblock=1`, `aq-mode=0`, bounded CRF/bitrate, and `-threads 2`), reducing constant background CPU utilization by up to ~40%.

## 2.1.3

- **Fix: Talkback 461 Unsupported Transport from Scrypted RTSP source**:
  - Automatically inject `-rtsp_transport tcp` before `-i` whenever Scrypted media converter serves the intercom audio as a local RTSP stream (`rtsp://127.0.0.1:...`).
  - FFmpeg defaults to UDP for RTSP, which caused Scrypted's internal RTSP server to reject playback with `method SETUP failed: 461 Unsupported Transport`, terminating the talkback session before sending any audio to RTMP.

## 2.1.2

- **Bridge 2.1.1 Update / Audio Stream Resilience**:
  - **Silence Generation Fallback**: Updated companion Tuya Camera Bridge with native PCMU silence injection when camera stream has no active audio track, preventing media player hangs and probe timeouts in Scrypted and HomeKit.
  - **WebRTC Audio Fixes**: Resolved packet drops on reconnects and network jitter, ensuring stable audio delivery as soon as the camera starts sending audio frames.

## 2.1.1

- **Fix: Talkback audio not reaching RTMP target (HomeKit intercom)**:
  - Replaced the `audio/x-wav` pipe-based approach with `ScryptedMimeTypes.FFmpegInput` conversion (same pattern used by the eufy-security Scrypted plugin). Scrypted now provides native FFmpeg input arguments directly, correctly handling whatever format HomeKit delivers (typically AAC) without an unnecessary WAV transcode hop.
  - Removed broken `-probesize 32` argument (32 bytes is smaller than a minimal WAV header, causing FFmpeg to silently fail on stream detection).
  - Removed manual `stdin` piping — `FFmpegInput.inputArguments` already encodes the correct `-i` source.
  - Changed FFmpeg log level from `error` to `warning` so talkback failures are now visible in Scrypted device logs.
  - Added diagnostic log lines: incoming `mimeType`, resolved RTMP target URL, and full FFmpeg argument list for easier future debugging.

> [!WARNING]
> ⚠️ **Experimental Feature / Work in Progress**:
> Two-Way Audio (Talkback / Intercom) is currently in active development and considered experimental. While the complete end-to-end streaming architecture (WebRTC / RTMP) and 8 kHz / 40 ms timing synchronization are implemented, the audio delivered to the camera speaker may still sound distorted or robotic on various Tuya hardware DAC implementations and has not yet been fully resolved.

- **Two-Way Audio (Talkback / Intercom) Support**:
  - Full talkback pipeline enabling two-way voice communication through Tuya / Smart Life cameras from Scrypted, HomeKit, and the Web UI.
  - **Scrypted Intercom Integration**: Implemented Scrypted `Intercom` interface routing two-way audio through the companion Bridge RTMP ingest endpoint with real-time FFmpeg resampling.
  - **Tuya WebRTC Audio Protocol**: Converted outbound voice stream to 8000 Hz mono G.711 μ-law with Tuya DAC signed-magnitude transformation in 40 ms frames, fixing 2× slowdown and pitch drop issues.
  - **Native Engine Talkback Channel**: Added dedicated UDP ingestion and monotonic RTP timestamp sequencing (+320 per 160-byte payload) for the camera's WebRTC audio send track in `tuya-streamer`.
  - **Web UI Controls**: Added interactive push-to-talk (PTT) and toggle talkback controls in the camera live player modal and camera cards.
- **Audio & Video Stream Improvements**:
  - Fixed audio codec declaration in Scrypted stream options (`h264` video, `aac` / `pcm_alaw` audio).
  - Cleaned up talkback audio filtering and buffering for ultra-low latency.

## 2.0.5

- **Fix H.264 RTSP relay 404 error & expose correct public stream URL**:
  - Migrate legacy `rtspPort=8554` DB entries to `RTSP_BASE_PORT` (8655) on startup (port 8554 is occupied by another service in HAOS environments, causing relay bind failure and HTTP 404 from ffmpeg DESCRIBE).
  - Changed `camera.entity.ts` default `rtspPort` from `8554` to `8655` to match `RTSP_BASE_PORT`.
  - Public RTSP URLs now show the actual host IP (resolved via HA Supervisor API in `run.sh`) instead of `127.0.0.1`.

## 2.0.4

- **Fix `spawn ffmpeg ENOENT` runtime error in Home Assistant Add-on**:
  - Added `ffmpeg` package to the final production container (`Stage 3`), restoring live camera snapshots, card previews, and WebRTC-to-browser H.264 transcoding.

## 2.0.3

- **Fix Docker container build hang on Raspberry Pi (`pnpm prune --prod`)**:
  - Replaced runtime `pnpm prune --prod` step with `pnpm --filter @tuya-bridge/server --legacy --prod deploy` in the build stage.
  - Generates an isolated, production-only `node_modules` tree with prebuilt native `better-sqlite3` bindings in the build stage.
  - Removed `pnpm` from the final runtime container for faster, deterministic image creation.

## 2.0.2

- **Fix `better-sqlite3` native bindings loading in Home Assistant add-on (`Could not locate the bindings file`)**:
  - Registered `better-sqlite3` in `onlyBuiltDependencies` in `pnpm-workspace.yaml` to authorize native lifecycle compilation under pnpm v10.
  - Multi-stage Docker optimization: installed `build-essential` & `python3` in `node-builder`, compiled native `.node` addons, and copied prebuilt modules directly into production container with `pnpm prune --prod`.

## 2.0.1

- **Fix Docker container startup errors**:
  - Approve `better-sqlite3` native build via `onlyBuiltDependencies` in `pnpm-workspace.yaml` (pnpm v10 lifecycle scripts approval).
  - Precompile `better-sqlite3` native bindings in build stage and copy into production runtime container.
  - Removed obsolete committed `tsconfig.build.tsbuildinfo` cache file that caused `tsc` to skip building server entrypoint `dist/main.js`.
  - Added clean step to remove `.tsbuildinfo` before building and added `*.tsbuildinfo` to `.gitignore`.
- **Home Assistant Web UI in new tab**:
  - Replaced `ingress: true` with `webui: "http://[HOST]:[PORT:6767]"` in `config.yaml` so the dashboard opens cleanly in its own browser tab.
- **Compiler warning cleanup**:
  - Fixed integer signedness comparison in `AVIOReassembler`.
  - Fixed missing struct field initializers in `IpcServer`.

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
