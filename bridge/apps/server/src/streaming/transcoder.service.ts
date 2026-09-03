import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { spawn, type ChildProcess } from "node:child_process";
import { NativeMediaEngine } from "../engine/native-engine.js";

export interface TranscodeSession {
  did: string;
  slug: string;
  sourceRtspUrl: string;
  targetRtspPort: number;
  process: ChildProcess | null;
  startTimer: NodeJS.Timeout | null;
  rtpPort: number;
  startedAt: number;
}

@Injectable()
export class TranscoderService implements OnModuleDestroy {
  private readonly logger = new Logger(TranscoderService.name);
  private readonly engine = NativeMediaEngine.getInstance();
  private sessions: Map<string, TranscodeSession> = new Map();

  onModuleDestroy() {
    this.stopAll();
  }

  public isTranscoding(did: string): boolean {
    return this.sessions.has(did);
  }

  public startH264Transcode(options: {
    did: string;
    slug: string;
    sourceRtspPort: number;
    sourceRtspPath: string;
    targetRtspPort: number;
  }): void {
    this.stopTranscode(options.did);

    const sourceRtspUrl = `rtsp://127.0.0.1:${options.sourceRtspPort}/${options.sourceRtspPath}`;
    const targetPath = `live/${options.slug}_h264`;
    const rtpPort = options.targetRtspPort + 1000;
    this.logger.log(
      `[Transcoder] Starting H264 relay for ${options.did} (${sourceRtspUrl} -> rtsp://127.0.0.1:${options.targetRtspPort}/${targetPath})`,
    );

    this.engine.startH264Relay(options.did, options.targetRtspPort, targetPath, rtpPort);
    const session: TranscodeSession = {
      did: options.did,
      slug: options.slug,
      sourceRtspUrl,
      targetRtspPort: options.targetRtspPort,
      process: null,
      startTimer: null,
      rtpPort,
      startedAt: Date.now(),
    };
    this.sessions.set(options.did, session);

    session.startTimer = setTimeout(() => {
      session.startTimer = null;
      if (this.sessions.get(options.did) !== session) return;
      const args = [
        "-hide_banner", "-loglevel", "warning",
        "-rtsp_transport", "tcp",
        "-use_wallclock_as_timestamps", "1",
        "-fflags", "nobuffer+discardcorrupt",
        "-flags", "low_delay",
        "-err_detect", "ignore_err",
        "-i", sourceRtspUrl,
        "-map", "0:v:0", "-an",
        "-vf", "fps=15",
        "-r", "15",
        "-fps_mode", "cfr",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-profile:v", "baseline",
        "-level:v", "4.1",
        "-pix_fmt", "yuv420p",
        "-g", "30", "-keyint_min", "30", "-bf", "0",
        "-x264-params", "repeat-headers=1:scenecut=0",
        "-f", "rtp", "-payload_type", "96",
        `rtp://127.0.0.1:${rtpPort}?pkt_size=1200`,
      ];

      try {
        const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
        session.process = proc;
        proc.stderr?.on("data", (chunk: Buffer) => {
          const msg = chunk.toString().trim();
          if (msg && !msg.includes("frame=") && !msg.includes("fps=")) {
            this.logger.debug(`[FFmpeg ${options.did}] ${msg}`);
          }
        });
        proc.once("error", (err) => {
          if (this.sessions.get(options.did) !== session) return;
          this.logger.error(`H264 transcoder failed for ${options.did}: ${err.message}`);
          this.stopTranscode(options.did);
        });
        proc.once("exit", (code, signal) => {
          if (this.sessions.get(options.did) !== session) return;
          this.logger.warn(`H264 transcoder for ${options.did} exited (code=${code}, signal=${signal})`);
          this.stopTranscode(options.did);
        });
      } catch (err: any) {
        this.logger.error(`Failed to spawn H264 transcoder for ${options.did}: ${err.message}`);
        this.stopTranscode(options.did);
      }
    }, 300);
    session.startTimer.unref();
  }

  public stopTranscode(did: string): void {
    const session = this.sessions.get(did);
    if (session) {
      this.logger.log(`Stopping x264 transcoder for ${did}`);
      if (session.startTimer) clearTimeout(session.startTimer);
      if (session.process) {
        try {
          session.process.kill("SIGTERM");
          setTimeout(() => {
            try {
              session.process?.kill("SIGKILL");
            } catch {}
          }, 2000).unref();
        } catch {}
      }
      this.sessions.delete(did);
      this.engine.stopH264Relay(did);
    }
  }

  public stopAll(): void {
    for (const did of this.sessions.keys()) {
      this.stopTranscode(did);
    }
  }
}
