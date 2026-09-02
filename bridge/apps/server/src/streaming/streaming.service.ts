import { Injectable } from "@nestjs/common";
import { CameraEntity } from "../db/entities/index.js";
import { env } from "../config/env.js";

@Injectable()
export class StreamingService {
  async getStreamInfo(did: string) {
    const cam = await CameraEntity.findOne({ where: [{ id: did }, { did }] });
    if (!cam) return null;

    const baseRtsp = `rtsp://127.0.0.1:${cam.rtspPort || env.RTSP_BASE_PORT}/${cam.rtspPath || `live/${cam.did}`}`;
    return {
      did: cam.did,
      name: cam.name,
      online: cam.online,
      rtspUrl: baseRtsp,
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
      rtspUrl: `rtsp://127.0.0.1:${cam.rtspPort || env.RTSP_BASE_PORT}/${cam.rtspPath || `live/${cam.did}`}`,
      lastSeen: cam.lastSeen,
    }));
  }
}
