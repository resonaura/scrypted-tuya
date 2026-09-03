export interface Camera {
  id: string;
  name: string;
  did: string;
  localKey?: string;
  ip?: string;
  port?: number;
  p2pId?: string;
  category?: string;
  productId?: string;
  uuid?: string;
  skill?: string;
  online: boolean;
  rtspPort: number;
  rtspPath: string;
  quality: "hd" | "sd";
  audioEnabled: boolean;
  transcodeH264?: boolean;
  h264Port?: number;
  lastSeen?: string;
  snapshot?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StreamInfo {
  did: string;
  name: string;
  online: boolean;
  rtspUrl: string;
  quality: string;
  audioEnabled: boolean;
  videoCodec: string;
  audioCodec: string;
}

export interface AuthState {
  loggedIn: boolean;
  region: string;
  regions: Record<string, { key: string; host: string; label: string }>;
  host: string;
  user: {
    uid: string;
    email: string;
    nickname: string;
  } | null;
  hasQr: boolean;
  qrToken?: string | null;
  qrDataUrl?: string | null;
  error?: string | null;
  sharingConfigured?: boolean;
}
