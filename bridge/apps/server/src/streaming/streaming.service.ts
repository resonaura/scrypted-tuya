import { Injectable } from "@nestjs/common";
import { CameraEntity } from "../db/entities/index.js";
import { env } from "../config/env.js";

/** Returns the public RTSP host (IP or hostname) for building external URLs. */
export function rtspPublicHost(): string {
  return env.RTSP_HOST || "localhost";
}

@Injectable()
export class StreamingService {
  async getStreamInfo(did: string) {
    const cam = await CameraEntity.findOne({ where: [{ id: did }, { did }] });
    if (!cam) return null;

    const port = cam.rtspPort || env.RTSP_BASE_PORT;
    const path = cam.rtspPath || `live/${cam.did}`;
    return {
      did: cam.did,
      name: cam.name,
      online: cam.online,
      rtspUrl: `rtsp://${rtspPublicHost()}:${port}/${path}`,
      quality: cam.quality,
      audioEnabled: cam.audioEnabled,
      videoCodec: "h265",
      audioCodec: "aac",
    };
  }

  async getAllStreams() {
    const cameras = await CameraEntity.find();
    return cameras.map((cam) => ({
      did: cam.did,
      name: cam.name,
      online: cam.online,
      rtspUrl: `rtsp://${rtspPublicHost()}:${cam.rtspPort || env.RTSP_BASE_PORT}/${cam.rtspPath || `live/${cam.did}`}`,
      lastSeen: cam.lastSeen,
    }));
  }
}
