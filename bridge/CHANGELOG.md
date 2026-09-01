# Tuya RTSP Bridge Changelog

## 1.2.7

- Remove ingress (port-forwarding does not work in add-on).
- Keep webui button to open the bridge Web UI directly.
- Fix Docker base image to use architecture-specific tag (amd64/aarch64/armv7).

## 1.2.6

- Add webui button for "Open Web UI" in HA add-on interface.
- Add icon.png for the add-on.

## 1.2.5

- Fix startup log command outside the Supervisor bashio shell.
- Add HTTP health check.

## 1.2.4

- Pin bridge backend to `DanEng1982/tuya-rtsp-bridge` v1.2.4.
