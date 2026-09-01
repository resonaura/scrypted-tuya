# scrypted-tuya

Unofficial standalone fork of the Tuya plugin from the [Scrypted repository](https://github.com/koush/scrypted), extracted from [`plugins/tuya`](https://github.com/koush/scrypted/tree/main/plugins/tuya).

The standalone extraction is based on upstream commit [`abd37e416dba4e36bcf9768ab6bbf1e82a206dd9`](https://github.com/koush/scrypted/commit/abd37e416dba4e36bcf9768ab6bbf1e82a206dd9). This repository contains only the Tuya plugin and does not include the rest of the Scrypted monorepository.

This project is unofficial and is not affiliated with or endorsed by Scrypted or Tuya.

## What changed

The upstream plugin requests a cloud RTSP stream from Tuya. For some cameras, Tuya returns the SD profile even when the camera also supports HD.

This fork checks the writable device capabilities advertised through the Tuya Sharing API before allocating the RTSP stream. If the camera exposes a video `quality`, `resolution`, `clarity`, `definition`, or `stream_quality` enum, the plugin requests the highest recognised value advertised by that camera.

Recognised values include common profiles such as:

- `hd`, `high`, `1080p`, and Tuya clarity value `4`;
- `2k`, `ultra`, `uhd`, and `4k`;
- lower profiles such as `sd`, `standard`, `720p`, and Tuya clarity value `2` are used only when no higher advertised option exists.

Unknown data points and values are not guessed. If the camera does not advertise a writable quality capability, or rejects the command, the plugin safely falls back to the RTSP quality selected by Tuya.

## Important limitation

Tuya's documented cloud RTSP allocation endpoint exposes the stream transport, such as RTSP or HLS, but does not expose a documented quality selector. Consequently, this fork can request maximum quality only on cameras that advertise a writable quality-related data point through the Sharing API.

Some models control HD exclusively through Tuya's P2P IPC SDK. Those cameras may still return an SD cloud RTSP stream. Check the actual stream resolution on the target camera after installation.

## Features

- Tuya and Smart Life camera discovery.
- Cloud RTSP camera streaming.
- Maximum advertised video-quality selection with safe fallback.
- Tuya doorbell ring notifications.
- Motion events on supported devices.
- Camera indicator and floodlight controls when exposed by the device.

## Authentication

The recommended login method is the QR-code flow using the Tuya or Smart Life application. The legacy Tuya Developer Account login remains available for existing configurations.

## Development

Requirements:

- Node.js
- npm
- a Scrypted server for deployment and runtime testing

Install dependencies and verify the project:

```bash
npm ci
npm run typecheck
npm run build
```

The Scrypted plugin archive is generated at:

```text
out/plugin.zip
```

Quality-selection tests are located in `tests/quality.test.ts` and can be run with Bun:

```bash
bun test tests/quality.test.ts
```

## Repository history

This repository is a standalone extraction rather than a GitHub network fork because GitHub cannot fork a single subdirectory of a monorepository. Upstream provenance is recorded in `STANDALONE-NOTICE.md` and `UPSTREAM-LICENSE-NOTICE.md`.

## License and attribution

The upstream Scrypted repository uses directory-specific licensing and does not declare a conventional SPDX license specifically for `plugins/tuya`. The original upstream notice is preserved in `UPSTREAM-LICENSE-NOTICE.md`.

Review the upstream terms and obtain any required permission before redistributing this fork or publishing derived packages. Copyright remains with the original contributors.

## Smart Life P2P HD through the Home Assistant add-on

For cameras that remain in **Smart Life**, Tuya Cloud RTSP may be fixed at 640×360. This repository therefore also exposes a Home Assistant add-on based on [DanEng1982/tuya-rtsp-bridge](https://github.com/DanEng1982/tuya-rtsp-bridge), which uses the MIT-licensed [seydx/tuya-ipc-terminal](https://github.com/seydx/tuya-ipc-terminal) WebRTC/P2P engine.

1. In Home Assistant, open **Settings → Add-ons → Add-on Store → Repositories**.
2. Add `https://github.com/resonaura/scrypted-tuya`.
3. Install and start **Tuya RTSP Bridge**.
4. Open `http://HOME_ASSISTANT_IP:8787`, create a QR code, then scan and confirm it in Smart Life.
5. Copy the camera HD URL. It has the form `rtsp://HOME_ASSISTANT_IP:8600/CameraName/hd`.
6. In Scrypted, open the matching camera created by this Tuya plugin and set **Smart Life P2P HD RTSP URL** to that URL.

The Tuya plugin will keep handling discovery, online state, motion, doorbell events, and controls. Video will come from the P2P/WebRTC bridge using the camera's main/HD stream. Removing the override restores the Tuya Cloud RTSP fallback.

The add-on is pinned to Tuya RTSP Bridge `v1.2.4` rather than an unversioned branch.
