import type { Camera } from "./types/index.js";
import { getApiBase } from "./api/client.js";

export function getCameraUrls(camera: Camera) {
  const slug = camera.name
    .toLowerCase()
    .replace(/\bcamera\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || camera.did;
  const apiBase = getApiBase() || (typeof window !== "undefined" ? window.location.origin : "");
  const snapshot = `${apiBase}/api/cameras/${encodeURIComponent(camera.id)}/snapshot`;
  const rtspHost = "localhost";
  const rtsp = `rtsp://${rtspHost}:${camera.rtspPort || 8655}/${camera.rtspPath || `live/${slug}-h265`}`;
  const h264Rtsp = camera.transcodeH264 && camera.h264Port
    ? `rtsp://${rtspHost}:${camera.h264Port}/live/${slug}-h264`
    : undefined;
  return { rtsp, h264Rtsp, snapshot, preview: `${snapshot}?t=${Date.now()}` };
}

export async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    if (!copied) throw new Error("Clipboard is unavailable");
  }
}
