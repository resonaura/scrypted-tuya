# Changelog

## 0.1.0-beta.11

- Add ingress and webui support to Tuya RTSP Bridge add-on (sidebar integration + Open Web UI button).
- Add ffprobe resolution hint and camera stream URL logging in getVideoStream.
- Add qualityToResolution() mapping for stream options hint.
- 1.5s delay between quality command and RTSP allocation.
- Improved logging for quality command acceptance/rejection.
- Rename tuya_rtsp_bridge to bridge.
- Remove chat.json from repo.

## 0.1.0-beta.10

- Add per-camera Smart Life P2P HD RTSP override while preserving Tuya events and controls.
- Add a Home Assistant add-on definition for QR-authenticated Smart Life WebRTC/P2P to RTSP bridging.
- Pin the bridge backend to `DanEng1982/tuya-rtsp-bridge` v1.2.4.
- Fix the add-on startup log command outside the Supervisor bashio shell and add an HTTP health check.

## 0.1.0-beta.9

- Request the highest recognised writable quality advertised by the camera schema before RTSP allocation.
- Safely fall back to Tuya's server-selected quality.

## 0.1.0-beta.7

fix: fix setTimeout undefined function
bump version

## 0.1.0-beta.6

chore: update changelog
fix: ensure timeout is actually correct and bound correctly
chore: bump version

## 0.1.0-beta.5

chore: update changelog
fix: use correct property for checking connection state
chore: bump version

## 0.1.0-beta.4

fix: resolve mqtt connection issues
bump version

## 0.1.0-beta.3

fixchangelog
changelog
quick fix
bump to beta 3

## 0.1.0-beta.2

update commit
bump version

## 0.1.0-beta.1

improve mqtt reconnect, also update status
wip: prevent setting motion if device has no motion detection
fix: resolve indicator not updating
feat: add support for light accessory in camera
wip: fetch rtsp from Tuya Sharing SDK

## 0.1.0

wip: allow changing between different login methods
wip: remove websocket for cameras since they are not supported

## 0.0.9

wip: update components

## 0.0.8

format code
replace tool to use `ffmpeg` and bump v0.0.8

## 0.0.7

plugins: update tsconfig.json
Updated Tuya to v0.0.7 (#408)

## 0.0.7-beta.2

tuya: fix crlf in candidate, fix empty stream name in rebroadcast, webrtc logging
remove null candidate

## 0.0.7-beta.1

Fix issue not being able to select your prebuffer

## 0.0.7-beta.0

Added support for webrtc, testing needed

## 0.0.6

Improvements in WebRTC
add initial support for webrtc
allow triggering doorbell (#361)

## 0.0.5

[Tuya Plugin] Fixed issue with devices not loading (#355)

## 0.0.4

Fix race condition for Tuya Devices (#351)

## 0.0.3

tuya: publish

## 0.0.1

tuya: project cleanups, remove unnecessary dependencies
Add Tuya Camera (and Doorbell Cameras) Support (#350)
