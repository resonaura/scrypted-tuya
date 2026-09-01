# Tuya RTSP Bridge — Home Assistant add-on

Turn Tuya / Smart Life cameras into plain RTSP endpoints for Frigate, go2rtc, Agent DVR, or VLC.

## Install (local add-on)

1. On the HA host (or via Samba/SSH), copy this folder to:
   ```
   /addons/tuya_rtsp_bridge
   ```
   The monorepo layout expects the **repo root** as Docker build context. Easiest path:
   ```bash
   git clone https://github.com/DanEng1982/tuya-rtsp-bridge.git /addons/tuya-rtsp-bridge-src
   ln -s /addons/tuya-rtsp-bridge-src/homeassistant/tuya_rtsp_bridge /addons/tuya_rtsp_bridge
   ```
2. In HA: **Settings → Add-ons → Add-on store → ⋮ → Check for updates**
3. Open **Local add-ons → Tuya RTSP Bridge → Install → Start**
4. Open the Web UI (`http://<ha-host>:8787`) → **Create QR** → scan & confirm in Smart Life
5. Use in Frigate / go2rtc:
   ```
   rtsp://<ha-host>:8554/<CameraName>/hd
   ```

## Requirements

- **host_network: true** (already set) — cameras need LAN WebRTC/UDP and PTZ TCP 6668
- Do **not** also enable the official Tuya cloud integration for the same cams (it steals the live session)

## Alternatives

If you prefer plain Docker on the HA host (no Supervisor add-on):

```bash
cd /path/to/tuya-rtsp-bridge
docker compose up -d --build
```

See [docs/docker.md](../../docs/docker.md).

## Notes

- Desktop GUI is **not** in the add-on (headless API only)
- Session files live under the add-on data volume — survive restarts
- No Tuya IoT Platform developer keys required for the QR flow
