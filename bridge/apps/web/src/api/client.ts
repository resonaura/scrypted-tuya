import type { Camera, AuthState } from "../types/index.js";

export function getApiBase(): string {
  if (typeof window === "undefined") return "";
  if (window.location.port === "6767") {
    return `${window.location.protocol}//${window.location.hostname}:6766`;
  }
  return "";
}

export function getWsUrl(): string {
  if (typeof window === "undefined") return "ws://127.0.0.1:6766/ws";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  if (window.location.port === "6767") {
    return `${protocol}//${window.location.hostname}:6766/ws`;
  }
  return `${protocol}//${window.location.host}/ws`;
}

export async function fetchCameras(): Promise<Camera[]> {
  const res = await fetch(`${getApiBase()}/api/cameras`);
  if (!res.ok) throw new Error("Failed to fetch cameras");
  return res.json();
}

export async function refreshCameras(): Promise<{
  success: boolean;
  cameras: Camera[];
}> {
  const res = await fetch(`${getApiBase()}/api/cameras/refresh`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to refresh cameras");
  return res.json();
}

export async function createCamera(data: Partial<Camera>): Promise<Camera> {
  const res = await fetch(`${getApiBase()}/api/cameras`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create camera");
  return res.json();
}

export async function updateCamera(camera: Camera, patch: Partial<Camera>): Promise<Camera> {
  return createCamera({ ...camera, ...patch, id: undefined });
}

export async function deleteCamera(id: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/api/cameras/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete camera");
}

export async function startCameraStream(
  id: string,
): Promise<{ success: boolean; rtspUrl: string }> {
  const res = await fetch(`${getApiBase()}/api/cameras/${id}/start`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to start stream");
  return res.json();
}

export async function stopCameraStream(id: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/api/cameras/${id}/stop`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to stop stream");
}

// Auth API
export async function fetchAuthState(): Promise<AuthState> {
  const res = await fetch(`${getApiBase()}/api/auth/state`);
  if (!res.ok) throw new Error("Failed to fetch auth state");
  return res.json();
}

export async function startQrFlow(
  region = "us",
): Promise<{ token: string; qrDataUrl: string; qrPayload: string }> {
  const res = await fetch(`${getApiBase()}/api/auth/qr/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ region }),
  });
  if (!res.ok) throw new Error("Failed to start QR flow");
  return res.json();
}

export async function pollQr(
  token?: string,
): Promise<{ loggedIn: boolean; loginResult?: any; error?: string }> {
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  const res = await fetch(`${getApiBase()}/api/auth/qr/poll${query}`);
  if (!res.ok) throw new Error("Failed to poll QR");
  return res.json();
}

export async function loginWithPassword(
  email: string,
  password: string,
  countryCode = "1",
  region = "us",
) {
  const res = await fetch(`${getApiBase()}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, countryCode, region }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Login failed" }));
    throw new Error(err.message || "Login failed");
  }
  return res.json();
}

export async function logout(): Promise<void> {
  const res = await fetch(`${getApiBase()}/api/auth/logout`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to logout");
}

export interface SystemConfig {
  rtspBasePort: number;
  serverPort: number;
  webPort: number;
  core: string;
  version: string;
}

export async function fetchSystemConfig(): Promise<SystemConfig> {
  const res = await fetch(`${getApiBase()}/api/system/config`);
  if (!res.ok) return { rtspBasePort: 8655, serverPort: 6766, webPort: 6767, core: "C++23 ZeroLatency", version: "1.0.0" };
  return res.json();
}


export async function createWebRtcViewer(did: string, offer: RTCSessionDescriptionInit): Promise<{ sessionId: string; answer: RTCSessionDescriptionInit }> {
  const res = await fetch(`${getApiBase()}/api/streaming/${encodeURIComponent(did)}/webrtc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(offer),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || "Failed to create WebRTC viewer");
  return res.json();
}

export async function stopWebRtcViewer(did: string, sessionId: string): Promise<void> {
  await fetch(`${getApiBase()}/api/streaming/${encodeURIComponent(did)}/webrtc/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    keepalive: true,
  }).catch(() => {});
}
