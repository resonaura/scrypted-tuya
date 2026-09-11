# Tuya Camera Bridge — Changelog

## 2.2.0

- **Continuous RTSP Stream & Seamless Offline Fallback**:
  - Implemented `switchToFallback` in `TranscoderService` ensuring the public RTSP relay (port 8655+) is pre-warmed and continuously streaming compliant H.264 Baseline + AAC audio packets 24/7.
  - Downstream RTSP clients (Scrypted, HomeKit, VLC, WebRTC browser player) never encounter socket reset, `Connection refused`, or RTP silence timeout during camera re-connections, Tuya signaling delays, or transient stream drops.
  - Offline video stream features Gaussian-blurred last-known live frame (`last_live.jpg`) or clean dark HUD overlay with live ticking clock (`%{pts:hms}`) and advancing RTP timestamps (1 fps).
  - Seamlessly transitions back to live camera transcode upon WebRTC/P2P `session_started` event without closing or resetting the RTSP socket.
- **Tuya Protect Session Resilience & Keep-Alive**:
  - Added background keep-alive ping (every 20 minutes to `/api/common/user/info`) preventing idle session expiry on Tuya Protect web platform (`protect-*.ismartlife.me`).
  - Added automatic debounced persistence of updated session cookies whenever Tuya returns `Set-Cookie` headers.
  - Fixed HTTP 401/403 status handling in `postApi()`: immediately emits `session_expired`, clears stale credentials, and prevents watchdog infinite reconnection storms.
  - Added `session_authenticated` event that automatically revives and connects all registered cameras immediately after QR scan or password login without server restart.
  - Added exponential backoff (up to 120s) and skip-recovery guards when logged out for cameras without local credentials.
- **Preserved Camera Configurations on Profile Logout**:
  - `logoutProfile()` no longer deletes registered camera entities or destroys RTSP relays. Cameras transition gracefully to offline HUD status ("Logged Out · Login in Web UI") while maintaining open RTSP sockets and database state.
- **RTP Fallback Muxer Fix**:
  - Fixed FFmpeg `[rtp @ ...] Only one stream supported in the RTP muxer` / `Error initializing output stream 0:1` by explicitly mapping `-map 0:v:0` for video and `-map 1:a:0` for audio RTP destinations.
- **Transcoder Failure Counter Reset**:
  - Automatically reset `consecutiveFailures = 0` whenever active `frame=` progress is received, avoiding spurious fallback locks after regular 10-minute Tuya P2P session renegotiations.
- **Frontend UI Polish**:
  - Removed jarring `animate-bounce` bouncing animation from the QR code icon on expired camera cards in `CameraCard.tsx`.
  - Replaced aggressive warning colors with clean, subtle neutral typography and status chips (`text-zinc-300`, neutral chip).

## 2.1.9

- **Fix Keyframe Request Flood (RTCP Marker-Bit Filter)**:
  - Fixed continuous PLI/FIR keyframe request spam caused by an overly broad RTCP filter (`bytes[1] >= 192`) that was incorrectly dropping the last RTP packet of every HEVC video frame (Marker bit: PT=96 | 0x80 = 224 ≥ 192).
  - Dropping the final FU packet of each frame prevented IDR frame assembly from completing in the RTSP server, causing the keyframe watchdog to continuously fire PLI requests to the camera.
  - Fixed by narrowing the RTCP drop range to the precise RTCP SR/RR/SDES/BYE/APP payload type range (200–207), leaving video RTP packets with Marker bit set (224, 225, etc.) untouched.
  - Result: keyframe requests now fire only every 10 seconds (normal watchdog cadence) rather than multiple times per second.
- **Session Expiry Guards**:
  - Added `isLoggedIn()` checks before attempting to start/recover camera streams to prevent connection attempts when the Tuya session is expired or logged out.
  - `CamerasService` now subscribes to `session_expired` events emitted by `TuyaProtectService` and calls `stopAllStreams()` to cleanly tear down active sessions.

- **Periodic Audio Click Fix (RTCP Demuxing & Filtering)**:
  - Fixed recurring ~5-second audio pop/click caused by unhandled RTCP Sender Report (SR) control packets arriving on the camera WebRTC audio track without `RtcpReceivingSession` media handler.
  - Attached `rtc::RtcpReceivingSession` handler to `audio_send_track_` in `tuya-streamer`, ensuring RTCP control frames are processed by libdatachannel's RTCP engine rather than forwarded as raw RTP media.
  - Added strict RFC 5761 multiplexing validation in `handle_rtp_packet` (dropping RTCP PT ranges 64–95 and $\ge 192$) to protect downstream RTP queue and PCM audio pipelines from control packets.
  - Synchronized audio timestamp anchoring and silenced synthetic silence loop after genuine audio packet arrival.

## 2.1.7

- **Camera Inbound Microphone Audio Stabilization**:
  - Overrode camera SDP Answer `a=recvonly` on `m=audio` to `a=sendrecv` in `tuya-streamer`, preventing WebRTC stacks from negotiating a send-only track and dropping microphone audio packets.
  - Aligned WebRTC SDP audio codec precedence (`PCMU/8000`, `PCMA/8000`, `L16`) with Tuya's native 16-bit linear PCM over PT 0.
  - Handled `INT16_MIN` boundary check in `linear_to_mulaw` transcoding.
  - Synchronized monorepo and plugin release versioning.

## 2.1.6

- Small fixes

## 2.1.5

- **Camera Inbound Microphone Audio Fix**:
  - Sent `{"type":"start","msg":"audio"}` over the WebRTC `fmp4Stream` DataChannel upon session setup, explicitly requesting the camera DSP to begin transmitting mic audio packets alongside video.
  - Restored fallback packet listener on `audio_send_track_` (`SendRecv` track) when a separate remote audio track is not created, preventing incoming camera RTP audio packets from being silently dropped.
- **Transcoder CPU & Resource Optimizations**:
  - **x264 Deblocking Bypass (`no-deblock=1`)**: Disabled in-loop deblocking filter in `transcoder.service.ts` for real-time H.264 relay, reducing CPU encode time by ~15–20% without noticeable quality degradation.
  - **Disabled Adaptive Quantization (`aq-mode=0`)**: Eliminated unnecessary psychovisual gradient analysis overhead for static security camera streams.
  - **Thread Limiting (`-threads 2`)**: Capped encoder/decoder threads to 2 to eliminate multi-core cache thrashing and context-switch spikes.
  - **Bitrate Bounding (`-crf 26 -maxrate 2500k -bufsize 2500k`)**: Stabilized encoder workload during camera sensor noise and dynamic scenes, preventing CPU saturation.
  - **Bypassed Software Filter Graph**: Replaced `-vf fps=15` with direct output pacing (`-r 15 -fps_mode cfr`), avoiding per-frame memory reallocations in `libavfilter`.
  - **Reduced Probe Windows**: Lowered `analyzeduration` and `probesize` from 1s to 500ms for faster relay initialization.

## 2.1.1

- **Audio Pipeline Reliability & Silence Fallback**:
  - **Automatic PCMU Silence Generation**: Injected dedicated background silence thread (`silence_loop`) into the native RTSP server emitting 20 ms standard G.711 μ-law frames (`0xFF`) at 8000 Hz when camera audio packets are absent. Prevents downstream decoders (FFmpeg, Scrypted, VLC, HomeKit) from hanging or timing out waiting for audio.
  - **Self-Throttling Audio Detection**: Silence generation automatically pauses as soon as genuine camera audio packets arrive (<150 ms threshold) and resumes seamlessly if audio stalls, maintaining continuous sequence numbers and timestamps per RTSP client.
  - **WebRTC Audio Reorder Buffer Fixes**:
    - Cleared `audio_reorder_` and `video_reorder_` states upon WebRTC ICE reconnect (`rtc::PeerConnection::State::Connected`) so stale sequence numbers from prior sessions do not cause subsequent incoming packets to be dropped.
    - Removed duplicate `onMessage` listener from the talkback outbound track (`audio_send_track_`) which was corrupting incoming sequence number tracking.
    - Increased audio packet reorder window (`max_pending`) from 2 to 6 packets to reliably handle minor network jitter without premature packet drops.

## 2.1.0

> [!WARNING]
> ⚠️ **Experimental Feature / Work in Progress**:
> Two-Way Audio (Talkback / Intercom) is currently in active development and considered experimental. While the complete end-to-end streaming architecture (WebRTC / RTMP) and 8 kHz / 40 ms timing synchronization are implemented, the audio delivered to the camera speaker may still sound distorted or robotic on various Tuya hardware DAC implementations and has not yet been fully resolved.

- **Two-Way Audio (Talkback / Intercom) Engine**:
  - Full talkback pipeline enabling two-way voice communication directly through Tuya / Smart Life cameras.
  - **RTMP Talkback Service**: Added RTMP audio ingest service (`rtmp.service.ts`) accepting incoming audio from Scrypted / HomeKit, transcoding to 8000 Hz mono s16le, and converting in real-time to Tuya signed DAC G.711 μ-law frames.
  - **WebRTC Talkback Integration**: Web UI microphone streaming via WebSocket gateway (`ws.gateway.ts`) with client-side 8000 Hz resampling and 40 ms framing (`TalkbackProvider.tsx`), fixing 2× playback slowdown and pitch drop.
  - **Native C++ Engine Support (`tuya-streamer`)**: Implemented talkback UDP listener, dynamic RTP payload sequencing (+320 sample increment per 160-byte DAC payload at 8 kHz), and Tuya codecType 101/0x81 handling in `peer.cpp`.
  - **HeroUI Controls**: Added animated Talkback Pill and push-to-talk / toggle controls to camera cards and video player modals.

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
