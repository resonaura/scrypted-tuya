import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { spawn, type ChildProcess } from "node:child_process";
import { env } from "../config/env.js";

export interface TranscodeSession {
  did: string;
  slug: string;
  sourceRtspUrl: string;
  targetRtspPort: number;
  process: ChildProcess | null;
  startedAt: number;
}

@Injectable()
export class TranscoderService implements OnModuleDestroy {
  private readonly logger = new Logger(TranscoderService.name);
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
    this.logger.log(
      `🎬 [Transcoder] Starting x264 transcode for ${options.did} (${sourceRtspUrl} -> port ${options.targetRtspPort})`,
    );

    const args = [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-rtsp_transport",
      "tcp",
      "-i",
      sourceRtspUrl,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-profile:v",
      "main",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "30",
      "-c:a",
      "copy",
      "-f",
      "rtsp",
      "-rtsp_transport",
      "tcp",
      `rtsp://127.0.0.1:${options.targetRtspPort}/live/${options.slug}_h264`,
    ];

    let proc: ChildProcess | null = null;
    try {
      proc = spawn("ffmpeg", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        const msg = chunk.toString().trim();
        if (msg && !msg.includes("frame=") && !msg.includes("fps=")) {
          this.logger.debug(`[FFmpeg ${options.did}] ${msg}`);
        }
      });

      proc.on("exit", (code, signal) => {
        this.logger.log(
          `[Transcoder] Process for ${options.did} exited with code ${code} (signal: ${signal})`,
        );
        this.sessions.delete(options.did);
      });

      this.sessions.set(options.did, {
        did: options.did,
        slug: options.slug,
        sourceRtspUrl,
        targetRtspPort: options.targetRtspPort,
        process: proc,
        startedAt: Date.now(),
      });
    } catch (err: any) {
      this.logger.error(
        `Failed to spawn FFmpeg x264 transcoder for ${options.did}: ${err.message}`,
      );
    }
  }

  public stopTranscode(did: string): void {
    const session = this.sessions.get(did);
    if (session) {
      this.logger.log(`Stopping x264 transcoder for ${did}`);
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
    }
  }

  public stopAll(): void {
    for (const did of this.sessions.keys()) {
      this.stopTranscode(did);
    }
  }
}
