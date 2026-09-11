import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { NativeMediaEngine } from "../engine/native-engine.js";
import { getDataDir } from "../cameras/offline-card.js";

export interface TranscodeSession {
  did: string;
  slug: string;
  sourceRtspUrl: string;
  targetRtspPort: number;
  process: ChildProcess | null;
  startTimer: NodeJS.Timeout | null;
  retryTimer?: NodeJS.Timeout | null;
  rtpPort: number;
  audioRtpPort: number;
  startedAt: number;
  stopped?: boolean;
  consecutiveFailures: number;
  isFallback: boolean;
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

  private stopSessionProcess(session: TranscodeSession): void {
    session.stopped = true;
    if (session.startTimer) clearTimeout(session.startTimer);
    if (session.retryTimer) clearTimeout(session.retryTimer);
    if (session.process) {
      session.process.removeAllListeners();
      try {
        session.process.kill("SIGTERM");
        const proc = session.process;
        setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {}
        }, 1000).unref();
      } catch {}
      session.process = null;
    }
  }

  public startH264Transcode(options: {
    did: string;
    slug: string;
    sourceRtspPort: number;
    sourceRtspPath: string;
    targetRtspPort: number;
    targetRtspPath?: string;
  }): void {
    const existing = this.sessions.get(options.did);
    const consecutiveFailures = existing ? existing.consecutiveFailures : 0;
    const relayAlreadyRunning = Boolean(
      existing &&
      !existing.stopped &&
      existing.targetRtspPort === options.targetRtspPort,
    );

    if (existing) {
      this.stopSessionProcess(existing);
      this.sessions.delete(options.did);
    }

    const sourceRtspUrl = `rtsp://127.0.0.1:${options.sourceRtspPort}/${options.sourceRtspPath}`;
    const targetPath = options.targetRtspPath || `live/${options.slug}`;
    const rtpPort = options.targetRtspPort + 1000;
    const audioRtpPort = rtpPort + 1;

    if (!relayAlreadyRunning) {
      this.logger.log(
        `[Transcoder] Starting H264 relay for ${options.did} (${sourceRtspUrl} -> rtsp://127.0.0.1:${options.targetRtspPort}/${targetPath})`,
      );
      this.engine.startH264Relay(
        options.did,
        options.targetRtspPort,
        targetPath,
        rtpPort,
        audioRtpPort,
      );
    }

    const session: TranscodeSession = {
      did: options.did,
      slug: options.slug,
      sourceRtspUrl,
      targetRtspPort: options.targetRtspPort,
      process: null,
      startTimer: null,
      rtpPort,
      audioRtpPort,
      startedAt: Date.now(),
      stopped: false,
      consecutiveFailures,
      isFallback: false,
    };
    this.sessions.set(options.did, session);

    const spawnDelay = relayAlreadyRunning ? 0 : 250;
    session.startTimer = setTimeout(() => {
      session.startTimer = null;
      if (session.stopped || this.sessions.get(options.did) !== session) return;

      const args = [
        "-hide_banner",
        "-loglevel",
        "warning",
        "-threads",
        "2",
        "-rtsp_transport",
        "tcp",
        "-fflags",
        "nobuffer+discardcorrupt",
        "-flags",
        "low_delay",
        "-analyzeduration",
        "500000",
        "-probesize",
        "500000",
        "-i",
        sourceRtspUrl,
        "-map",
        "0:v:0",
        "-r",
        "15",
        "-fps_mode",
        "cfr",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        "-profile:v",
        "baseline",
        "-level:v",
        "4.1",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "26",
        "-maxrate",
        "2500k",
        "-bufsize",
        "2500k",
        "-g",
        "30",
        "-keyint_min",
        "30",
        "-bf",
        "0",
        "-x264-params",
        "no-deblock=1:aq-mode=0:repeat-headers=1:scenecut=0",
        "-f",
        "rtp",
        "-payload_type",
        "96",
        `rtp://127.0.0.1:${rtpPort}?pkt_size=1200`,
        "-map",
        "0:a:0?",
        "-af",
        "aresample=async=1:first_pts=0",
        "-c:a",
        "aac",
        "-profile:a",
        "aac_low",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-b:a",
        "64k",
        "-f",
        "rtp",
        "-payload_type",
        "97",
        `rtp://127.0.0.1:${audioRtpPort}?pkt_size=1200`,
      ];

      try {
        const proc = spawn("ffmpeg", args, {
          stdio: ["ignore", "ignore", "pipe"],
        });
        session.process = proc;
        proc.stderr?.on("data", (chunk: Buffer) => {
          const msg = chunk.toString().trim();
          if (msg.includes("frame=")) {
            session.consecutiveFailures = 0;
          }
          if (msg && !msg.includes("frame=") && !msg.includes("fps=")) {
            this.logger.debug(`[FFmpeg ${options.did}] ${msg}`);
          }
        });
        proc.once("error", (err) => {
          if (session.stopped || this.sessions.get(options.did) !== session)
            return;
          this.logger.error(
            `H264 transcoder failed for ${options.did}: ${err.message}`,
          );
        });
        proc.once("exit", (code, signal) => {
          if (session.stopped || this.sessions.get(options.did) !== session)
            return;
          session.consecutiveFailures++;
          this.logger.warn(
            `H264 transcoder for ${options.did} exited (code=${code}, signal=${signal}), failure count: ${session.consecutiveFailures}`,
          );

          // Stream fallback card IMMEDIATELY to keep downstream RTSP connection alive without drops
          this.startFallbackTranscode(options, session);
        });
      } catch (err: any) {
        this.logger.error(
          `Failed to spawn H264 transcoder for ${options.did}: ${err.message}`,
        );
        this.startFallbackTranscode(options, session);
      }
    }, spawnDelay);
    session.startTimer.unref();
  }

  public switchToFallback(options: {
    did: string;
    slug: string;
    sourceRtspPort?: number;
    sourceRtspPath?: string;
    targetRtspPort: number;
    targetRtspPath?: string;
  }): void {
    let session = this.sessions.get(options.did);
    if (session && session.isFallback && session.process && !session.stopped) {
      return;
    }

    const sourceRtspPort =
      options.sourceRtspPort || options.targetRtspPort + 20000;
    const sourceRtspPath = options.sourceRtspPath || `internal/${options.slug}`;
    const targetPath = options.targetRtspPath || `live/${options.slug}`;
    const rtpPort = options.targetRtspPort + 1000;
    const audioRtpPort = rtpPort + 1;

    const relayAlreadyRunning = Boolean(
      session &&
      !session.stopped &&
      session.targetRtspPort === options.targetRtspPort,
    );

    if (!relayAlreadyRunning) {
      this.engine.startH264Relay(
        options.did,
        options.targetRtspPort,
        targetPath,
        rtpPort,
        audioRtpPort,
      );
    }

    if (session) {
      if (session.startTimer) clearTimeout(session.startTimer);
      if (session.retryTimer) clearTimeout(session.retryTimer);
      if (session.process) {
        session.process.removeAllListeners();
        try {
          session.process.kill("SIGKILL");
        } catch {}
      }
      session.isFallback = true;
      session.stopped = false;
    } else {
      session = {
        did: options.did,
        slug: options.slug,
        sourceRtspUrl: `rtsp://127.0.0.1:${sourceRtspPort}/${sourceRtspPath}`,
        targetRtspPort: options.targetRtspPort,
        process: null,
        startTimer: null,
        rtpPort,
        audioRtpPort,
        startedAt: Date.now(),
        stopped: false,
        consecutiveFailures: 0,
        isFallback: true,
      };
      this.sessions.set(options.did, session);
    }

    this.startFallbackTranscode(
      {
        did: options.did,
        slug: options.slug,
        sourceRtspPort,
        sourceRtspPath,
        targetRtspPort: options.targetRtspPort,
        targetRtspPath: targetPath,
      },
      session,
    );
  }

  private startFallbackTranscode(
    options: {
      did: string;
      slug: string;
      sourceRtspPort: number;
      sourceRtspPath: string;
      targetRtspPort: number;
      targetRtspPath?: string;
    },
    session: TranscodeSession,
  ): void {
    if (session.stopped || this.sessions.get(options.did) !== session) return;
    session.isFallback = true;
    this.logger.log(
      `[Transcoder] Streaming fallback placeholder for ${options.did} to preserve RTSP session`,
    );

    const framesDir = path.join(getDataDir(), "frames");
    const lastLiveFile = path.join(framesDir, `${options.slug}.last_live.jpg`);
    const frameFile = path.join(framesDir, `${options.slug}.jpg`);
    const lastLiveExists = existsSync(lastLiveFile);
    const fallbackImageExists = existsSync(frameFile);

    let inputArgs: string[];
    let videoFilter: string;

    if (lastLiveExists) {
      inputArgs = ["-loop", "1", "-framerate", "1", "-re", "-i", lastLiveFile];
      videoFilter = [
        "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black",
        "gblur=sigma=18:steps=2",
        "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.55:t=fill",
        "drawtext=text='OFFLINE':fontcolor=white@0.95:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2-20:shadowcolor=black@0.5:shadowx=2:shadowy=2",
        "drawtext=text='%{pts\\:hms}':fontcolor=white@0.70:fontsize=26:x=(w-text_w)/2:y=(h-text_h)/2+28:shadowcolor=black@0.5:shadowx=1:shadowy=1",
      ].join(",");
    } else if (fallbackImageExists) {
      inputArgs = ["-loop", "1", "-framerate", "1", "-re", "-i", frameFile];
      videoFilter = [
        "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black",
        "drawtext=text='%{pts\\:hms}':fontcolor=white@0.70:fontsize=24:x=(w-text_w)/2:y=h-60:shadowcolor=black@0.5:shadowx=1:shadowy=1",
      ].join(",");
    } else {
      inputArgs = [
        "-re",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x111116:s=1280x720:r=1",
      ];
      videoFilter = [
        "drawtext=text='OFFLINE':fontcolor=white@0.95:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2-20:shadowcolor=black@0.5:shadowx=2:shadowy=2",
        "drawtext=text='%{pts\\:hms}':fontcolor=white@0.70:fontsize=26:x=(w-text_w)/2:y=(h-text_h)/2+28:shadowcolor=black@0.5:shadowx=1:shadowy=1",
      ].join(",");
    }

    const fallbackArgs = [
      "-hide_banner",
      "-loglevel",
      "warning",
      ...inputArgs,
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=16000:cl=mono",
      "-vf",
      videoFilter,
      "-map",
      "0:v:0",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "stillimage",
      "-profile:v",
      "baseline",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "2",
      "-r",
      "1",
      "-f",
      "rtp",
      "-payload_type",
      "96",
      `rtp://127.0.0.1:${session.rtpPort}?pkt_size=1200`,
      "-map",
      "1:a:0",
      "-c:a",
      "aac",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-b:a",
      "32k",
      "-f",
      "rtp",
      "-payload_type",
      "97",
      `rtp://127.0.0.1:${session.audioRtpPort}?pkt_size=1200`,
    ];

    try {
      const proc = spawn("ffmpeg", fallbackArgs, {
        stdio: ["ignore", "ignore", "pipe"],
      });
      session.process = proc;
      proc.stderr?.on("data", (chunk: Buffer) => {
        const msg = chunk.toString().trim();
        if (msg && !msg.includes("frame=") && !msg.includes("fps=")) {
          this.logger.debug(`[FFmpeg Fallback ${options.did}] ${msg}`);
        }
      });
      proc.once("exit", () => {
        if (session.stopped || this.sessions.get(options.did) !== session)
          return;
        // Periodically retry the real live stream
        session.retryTimer = setTimeout(() => {
          if (session.stopped || this.sessions.get(options.did) !== session)
            return;
          this.startH264Transcode(options);
        }, 3000);
        session.retryTimer.unref();
      });
    } catch (err: any) {
      this.logger.error(
        `Failed to spawn fallback transcoder for ${options.did}: ${err.message}`,
      );
    }
  }

  public stopTranscode(did: string): void {
    const session = this.sessions.get(did);
    if (session) {
      this.stopSessionProcess(session);
      this.sessions.delete(did);
      this.engine.stopH264Relay(did);
    }
  }

  public stopAll(): void {
    for (const did of Array.from(this.sessions.keys())) {
      this.stopTranscode(did);
    }
  }
}
