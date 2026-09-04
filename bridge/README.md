<img src="icon.png" width="64" height="64" alt="Tuya Bridge Icon" />

# Tuya Camera Bridge — Home Assistant Add-on

[![Version](https://img.shields.io/badge/version-2.0.5-blue.svg)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](../LICENSE)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-Add--on-orange.svg)](https://www.home-assistant.io/)
[![C++23 Engine](https://img.shields.io/badge/Native%20Engine-C%2B%2B23-00599C.svg)](apps/native)
[![GHCR Image](https://img.shields.io/badge/Docker-GHCR-2496ED?logo=docker&logoColor=white)](https://github.com/resonaura/scrypted-tuya/pkgs/container/tuya-rtsp-bridge%2Faarch64)

Full-stack Tuya / Smart Life camera bridge with live P2P/WebRTC-to-RTSP conversion, Web UI, and seamless Scrypted integration.

## What is this?

This add-on provides:

- **Native C++ streaming engine** — WebRTC P2P to RTSP re-streaming with monotonic timeline, full RTSP/1.0 SDP compliance (VLC clock ticking, frame-accurate timestamps)
- **NestJS REST + WebSocket backend** — camera profile management, QR-login flow, snapshot API
- **React / HeroUI web frontend** — live preview, camera cards, add-camera modal with styled QR code

## Install via Home Assistant Add-on Store
 
### 1-Click Install
 
[![Open your Home Assistant instance and show the add add-on repository dialog with a specific repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fresonaura%2Fscrypted-tuya)
 
### Manual Install
 
1. **Settings → Add-ons → Add-on Store → ⋮ → Repositories**
2. Add `https://github.com/resonaura/scrypted-tuya`
3. Install **Tuya Camera Bridge**, click **Start**
4. Open the Web UI (ingress or `http://<ha-host>:6767`)
5. Create a new profile → scan the QR code in the Smart Life app
6. Copy the camera RTSP URL: `rtsp://<ha-host>:8655/<CameraName>`
 
## Standalone Docker (without Home Assistant)
 
```bash
git clone https://github.com/resonaura/scrypted-tuya.git
cd scrypted-tuya/bridge
docker compose up -d --build
```
See [`docker-compose.example.yml`](./docker-compose.example.yml) for full container options.

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
