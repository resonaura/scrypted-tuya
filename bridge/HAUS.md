# Haus camera handoff

The ordinary `/api/cameras/<id>/snapshot` route keeps its Offline-card behavior. Haus uses `/api/cameras/<id>/snapshot/last-live` to read the last real captured JPEG without starting or decoding a stream. The independent real-only cache survives process restart. No real image means 404.

Responses carry `X-Haus-Snapshot-Profile: 1`, `X-Haus-Snapshot-Provider: tuya`, `X-Haus-Snapshot-Captured-At` (Unix milliseconds) and `X-Haus-Snapshot-Stale: 0|1` (30 seconds without a frame). The time is never renewed merely by reading the file.

`GET /api/haus/cameras` advertises version 1, provider `tuya`, and each camera's RTSP protocol/port/path and relative real-snapshot path. It contains no device keys or HA credentials. Haus discovers the installed add-on through Supervisor and matches the actual Generic camera stream and host identity. It does not match names/rooms or ask the bridge to push data to an unverified Haus instance. External integrations can advertise the same capability through attributes `haus_snapshot_profile`, `haus_snapshot_provider` and `haus_snapshot_url` on the camera or a sensor on its registered physical HA device.
