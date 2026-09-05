import { Injectable } from "@nestjs/common";
import { CameraEntity } from "../db/entities/index.js";
import { env } from "../config/env.js";

import { cameraSlug } from "../utils/camera-slug.js";

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
    const slug = cameraSlug(cam.name, cam.did);
    return {
      did: cam.did,
      name: cam.name,
      online: cam.online,
      rtspUrl: `rtsp://${rtspPublicHost()}:${port}/${path}`,
      rtmpUrl: `rtmp://${rtspPublicHost()}:${env.RTMP_PORT}/talk/${slug}`,
      quality: cam.quality,
      audioEnabled: cam.audioEnabled,
      videoCodec: "h265",
      audioCodec: "aac",
    };
  }

  async getAllStreams() {
    const cameras = await CameraEntity.find();
    return cameras.map((cam) => {
      const slug = cameraSlug(cam.name, cam.did);
      return {
        did: cam.did,
        name: cam.name,
        online: cam.online,
        rtspUrl: `rtsp://${rtspPublicHost()}:${cam.rtspPort || env.RTSP_BASE_PORT}/${cam.rtspPath || `live/${cam.did}`}`,
        rtmpUrl: `rtmp://${rtspPublicHost()}:${env.RTMP_PORT}/talk/${slug}`,
        lastSeen: cam.lastSeen,
      };
    });
  }
}
