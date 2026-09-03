import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { CameraEntity } from "../db/entities/index.js";
import { NativeMediaEngine } from "../engine/native-engine.js";
import { env } from "../config/env.js";

interface ViewerSession {
  id: string;
  did: string;
  rtspUrl: string;
  rtpPort?: number;
  audioRtpPort?: number;
  ffmpeg?: ChildProcess;
  createdAt: number;
  cleanupTimer: NodeJS.Timeout;
  generation: number;
}

@Injectable()
export class BrowserWebRtcService implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserWebRtcService.name);
  private readonly engine = NativeMediaEngine.getInstance();
  private readonly sessions = new Map<string, ViewerSession>();
  private generation = 0;

  constructor() {
    this.engine.on("viewer_state", (viewerId: string, _did: string, state: string) => {
      if (state === "closed") this.stop(viewerId);
    });
  }

  async create(did: string, browserOffer: string): Promise<{ sessionId: string; answer: RTCSessionDescriptionInit }> {
    const cam = await CameraEntity.findOne({ where: [{ id: did }, { did }] });
    if (!cam) throw new Error("Camera not found");

    const id = randomUUID();
    const generation = ++this.generation;
    const rtspUrl = `rtsp://127.0.0.1:${cam.rtspPort || env.RTSP_BASE_PORT}/${cam.rtspPath || `live/${cam.did}`}`;
    const cleanupTimer = setTimeout(() => this.stop(id), 10 * 60_000);
    cleanupTimer.unref();
    this.sessions.set(id, { id, did: cam.did, rtspUrl, createdAt: Date.now(), cleanupTimer, generation });

    const offer = await new Promise<{ sdp: string; rtpPort: number; audioRtpPort: number }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for native WebRTC answer"));
      }, 8000);
      timeout.unref();

      const onOffer = (
        viewerId: string,
        _cameraDid: string,
        sdp: string,
        rtpPort: number,
        audioRtpPort: number,
      ) => {
        if (viewerId !== id) return;
        cleanup();
        resolve({ sdp, rtpPort, audioRtpPort });
      };
      const cleanup = () => {
        clearTimeout(timeout);
        this.engine.off("viewer_offer", onOffer);
      };
      this.engine.on("viewer_offer", onOffer);
      this.logger.log(`[BrowserWebRtcService] Requesting native viewer for ${cam.did}, id=${id}`);
      this.engine.startViewer(id, cam.did, browserOffer);
    }).catch((error) => {
      this.stop(id);
      throw error;
    });

    const session = this.sessions.get(id);
    if (!session || session.generation !== generation) throw new Error("Viewer session was cancelled");
    session.rtpPort = offer.rtpPort;
    session.audioRtpPort = offer.audioRtpPort;
    this.startFfmpeg(session);
    return { sessionId: id, answer: { type: "answer", sdp: offer.sdp } };
  }

  stop(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    clearTimeout(session.cleanupTimer);
    if (session.ffmpeg) {
      session.ffmpeg.removeAllListeners();
      try { session.ffmpeg.kill("SIGTERM"); } catch {}
      const proc = session.ffmpeg;
      const killTimer = setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch {}
      }, 1500);
      killTimer.unref();
    }
    this.engine.stopViewer(session.id, session.did);
  }

  onModuleDestroy(): void {
    for (const id of [...this.sessions.keys()]) this.stop(id);
    this.engine.removeAllListeners("viewer_state");
  }

  private startFfmpeg(session: ViewerSession): void {
    const args = [
      "-hide_banner", "-loglevel", "warning",
      "-rtsp_transport", "tcp",
      "-fflags", "nobuffer+discardcorrupt",
      "-flags", "low_delay",
      "-analyzeduration", "500000",
      "-probesize", "500000",
      "-i", session.rtspUrl,
      "-map", "0:v:0",
      "-vf", "fps=15",
      "-r", "15",
      "-fps_mode", "cfr",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-tune", "zerolatency",
      "-profile:v", "baseline",
      "-level:v", "4.1",
      "-pix_fmt", "yuv420p",
      "-g", "30",
      "-keyint_min", "30",
      "-bf", "0",
      "-x264-params", "repeat-headers=1:scenecut=0",
      "-f", "rtp",
      "-payload_type", "96",
      `rtp://127.0.0.1:${session.rtpPort}?pkt_size=1200`,
      "-map", "0:a:0?",
      "-af", "aresample=async=1000",
      "-c:a", "libopus",
      "-application", "lowdelay",
      "-frame_duration", "20",
      "-ar", "48000",
      "-ac", "1",
      "-b:a", "32k",
      "-f", "rtp",
      "-payload_type", "111",
      `rtp://127.0.0.1:${session.audioRtpPort}?pkt_size=1200`,
    ];

    this.logger.log(`Spawning browser transcoder for ${session.did} (rtp=${session.rtpPort}, audioRtp=${session.audioRtpPort}, url=${session.rtspUrl})`);
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    session.ffmpeg = proc;
    let lastError = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length) {
        lastError = lines.at(-1)!;
        this.logger.debug(`[BrowserFFmpeg ${session.did}] ${lastError}`);
      }
    });
    proc.once("error", (error) => {
      if (this.sessions.get(session.id)?.generation !== session.generation) return;
      this.logger.warn(`Browser transcoder failed for ${session.did}: ${error.message}`);
      this.stop(session.id);
    });
    proc.once("exit", (code, signal) => {
      this.logger.log(`Browser transcoder exited for ${session.did} (code=${code}, signal=${signal})`);
      if (this.sessions.get(session.id)?.generation !== session.generation) return;
      if (code !== 0 && signal !== "SIGTERM") {
        this.logger.warn(`Browser transcoder error for ${session.did}: ${lastError}`);
      }
      this.stop(session.id);
    });
  }
}
