import type { Camera } from "./types/index.js";
import { getApiBase } from "./api/client.js";

export function getCameraUrls(camera: Camera) {
  const slug = camera.name
    .toLowerCase()
    .replace(/\bcamera\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || camera.did;
  const apiBase = getApiBase() || (typeof window !== "undefined" ? window.location.origin : "");
  const snapshot = `${apiBase}/api/cameras/${encodeURIComponent(slug)}/snapshot`;
  const rtspHost = (typeof window !== "undefined" && window.location.hostname) ? window.location.hostname : "localhost";
  const rtsp = `rtsp://${rtspHost}:${camera.rtspPort || 8655}/${camera.rtspPath || `live/${slug}`}`;
  return { rtsp, snapshot, preview: `${snapshot}?t=${Date.now()}` };
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
