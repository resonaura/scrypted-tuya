# Tuya Camera Bridge — Home Assistant Add-on

Full-stack Tuya / Smart Life camera bridge with live P2P/WebRTC-to-RTSP conversion, Web UI, and seamless Scrypted integration.

## What is this?

This add-on provides:

- **Native C++ streaming engine** — WebRTC P2P to RTSP re-streaming with monotonic timeline, full RTSP/1.0 SDP compliance (VLC clock ticking, frame-accurate timestamps)
- **NestJS REST + WebSocket backend** — camera profile management, QR-login flow, snapshot API
- **React / HeroUI web frontend** — live preview, camera cards, add-camera modal with styled QR code

## Install via Home Assistant Add-on Store

1. **Settings → Add-ons → Add-on Store → ⋮ → Repositories**
2. Add `https://github.com/resonaura/scrypted-tuya`
3. Install **Tuya Camera Bridge**, click **Start**
4. Open the Web UI (ingress or `http://<ha-host>:6767`)
5. Create a new profile → scan the QR code in the Smart Life app
6. Copy the camera RTSP URL: `rtsp://<ha-host>:8655/<CameraName>`

## Ports

| Port | Purpose |
|------|---------|
| `6766` | REST / WebSocket API |
| `6767` | Web UI (also ingress) |
| `8655+` | RTSP streams (one per camera) |

## Scrypted integration

In Scrypted, set the camera **Smart Life P2P HD RTSP URL** to the RTSP address shown in the Web UI. The Tuya Scrypted plugin continues to handle discovery, motion events, doorbells, and controls.

## Attribution

This add-on was inspired by the original **[DanEng1982/tuya-rtsp-bridge](https://github.com/DanEng1982/tuya-rtsp-bridge)** project. We are grateful for DanEng1982's pioneering work on Tuya P2P bridging.  
The current implementation is a from-scratch rewrite with a custom C++ RTSP engine, NestJS backend, and React frontend — built independently on top of the WebRTC primitives.

## Requirements

- `host_network: true` — cameras need LAN WebRTC/UDP
- No Tuya IoT Platform developer keys required for the QR flow
