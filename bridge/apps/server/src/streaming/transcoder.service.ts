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
  retryTimer?: NodeJS.Timeout | null;
  rtpPort: number;
  audioRtpPort: number;
  startedAt: number;
  stopped?: boolean;
}

interface AudioFeederSession {
  proc: ChildProcess | null;
  audioPort: number;
  getFreshUrl?: () => Promise<string | null>;
  retryTimer?: NodeJS.Timeout;
  stopped: boolean;
}

@Injectable()
export class TranscoderService implements OnModuleDestroy {
  private readonly logger = new Logger(TranscoderService.name);
  private readonly engine = NativeMediaEngine.getInstance();
  private sessions: Map<string, TranscodeSession> = new Map();
  private nativeAudioFeeders: Map<string, AudioFeederSession> = new Map();

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
    cloudRtspUrl?: string;
  }): void {
    this.stopTranscode(options.did);

    const sourceRtspUrl = `rtsp://127.0.0.1:${options.sourceRtspPort}/${options.sourceRtspPath}`;
    const targetPath = `live/${options.slug}-h264`;
    const rtpPort = options.targetRtspPort + 1000;
    const audioRtpPort = rtpPort + 1;
    const hasCloudAudio = Boolean(options.cloudRtspUrl);
    this.logger.log(
      `[Transcoder] Starting H264 relay for ${options.did} (${sourceRtspUrl} -> rtsp://127.0.0.1:${options.targetRtspPort}/${targetPath}, cloudAudio=${hasCloudAudio})`,
    );

    this.engine.startH264Relay(
      options.did,
      options.targetRtspPort,
      targetPath,
      rtpPort,
      audioRtpPort,
    );
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
    };
    this.sessions.set(options.did, session);

    session.startTimer = setTimeout(() => {
      session.startTimer = null;
      if (session.stopped || this.sessions.get(options.did) !== session) return;

      const args = [
        "-hide_banner", "-loglevel", "warning",
        "-rtsp_transport", "tcp",
        "-fflags", "nobuffer+discardcorrupt",
        "-flags", "low_delay",
        "-analyzeduration", "1000000",
        "-probesize", "1000000",
        "-i", sourceRtspUrl,
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
        "-g", "30", "-keyint_min", "30", "-bf", "0",
        "-x264-params", "repeat-headers=1:scenecut=0",
        "-f", "rtp", "-payload_type", "96",
        `rtp://127.0.0.1:${rtpPort}?pkt_size=1200`,
        "-map", "0:a:0?",
        "-af", "aresample=async=1000",
        "-c:a", "aac",
        "-profile:a", "aac_low",
        "-ar", "16000",
        "-ac", "1",
        "-b:a", "64k",
        "-f", "rtp", "-payload_type", "97",
        `rtp://127.0.0.1:${audioRtpPort}?pkt_size=1200`,
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
          if (session.stopped || this.sessions.get(options.did) !== session) return;
          this.logger.error(`H264 transcoder failed for ${options.did}: ${err.message}`);
        });
        proc.once("exit", (code, signal) => {
          if (session.stopped || this.sessions.get(options.did) !== session) return;
          this.logger.warn(`H264 transcoder for ${options.did} exited (code=${code}, signal=${signal}), restarting in 2s...`);
          session.retryTimer = setTimeout(() => {
            if (session.stopped || this.sessions.get(options.did) !== session) return;
            this.startH264Transcode(options);
          }, 2000);
          session.retryTimer.unref();
        });
      } catch (err: any) {
        this.logger.error(`Failed to spawn H264 transcoder for ${options.did}: ${err.message}`);
      }
    }, 300);
    session.startTimer.unref();
  }

  public stopTranscode(did: string): void {
    const session = this.sessions.get(did);
    if (session) {
      session.stopped = true;
      if (session.startTimer) clearTimeout(session.startTimer);
      if (session.retryTimer) clearTimeout(session.retryTimer);
      if (session.process) {
        session.process.removeAllListeners();
        try {
          session.process.kill("SIGTERM");
          const proc = session.process;
          setTimeout(() => {
            try { proc.kill("SIGKILL"); } catch {}
          }, 1500).unref();
        } catch {}
      }
      this.sessions.delete(did);
      this.engine.stopH264Relay(did);
    }
  }

  public startNativeCloudAudio(
    did: string,
    cloudRtspUrl: string,
    audioPort: number,
    getFreshUrl?: () => Promise<string | null>,
  ): void {
    this.stopNativeCloudAudio(did);

    this.engine.startAudioIngest(did, audioPort);

    const feeder: AudioFeederSession = {
      proc: null,
      audioPort,
      getFreshUrl,
      stopped: false,
    };
    this.nativeAudioFeeders.set(did, feeder);

    const spawnFeeder = (url: string) => {
      if (feeder.stopped) return;
      const args = [
        "-hide_banner", "-loglevel", "warning",
        "-rtsp_transport", "tcp",
        "-fflags", "nobuffer+discardcorrupt",
        "-flags", "low_delay",
        "-i", url,
        "-vn",
        "-c:a", "copy",
        "-f", "rtp",
        "-payload_type", "0",
        `rtp://127.0.0.1:${audioPort}?pkt_size=1200`,
      ];

      try {
        const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
        feeder.proc = proc;
        this.logger.log(`[Transcoder] Started native Cloud Audio feeder for ${did} -> rtp port ${audioPort}`);
        proc.once("exit", (code, signal) => {
          if (feeder.stopped || this.nativeAudioFeeders.get(did) !== feeder) return;
          this.logger.warn(`[Transcoder] Native Cloud Audio feeder for ${did} exited (code=${code}, signal=${signal}), reconnecting in 2s...`);
          feeder.retryTimer = setTimeout(async () => {
            if (feeder.stopped) return;
            try {
              const freshUrl = feeder.getFreshUrl ? await feeder.getFreshUrl() : url;
              if (freshUrl) spawnFeeder(freshUrl);
            } catch (err: any) {
              this.logger.error(`Failed to refresh Cloud Audio URL for ${did}: ${err.message}`);
            }
          }, 2000);
          feeder.retryTimer.unref();
        });
      } catch (err: any) {
        this.logger.error(`Failed to spawn native Cloud Audio feeder for ${did}: ${err.message}`);
      }
    };

    spawnFeeder(cloudRtspUrl);
  }

  public stopNativeCloudAudio(did: string): void {
    const feeder = this.nativeAudioFeeders.get(did);
    if (feeder) {
      feeder.stopped = true;
      if (feeder.retryTimer) clearTimeout(feeder.retryTimer);
      if (feeder.proc) {
        feeder.proc.removeAllListeners();
        try { feeder.proc.kill("SIGTERM"); } catch {}
      }
      this.nativeAudioFeeders.delete(did);
    }
  }

  public stopAll(): void {
    for (const did of Array.from(this.nativeAudioFeeders.keys())) {
      this.stopNativeCloudAudio(did);
    }
    for (const did of Array.from(this.sessions.keys())) {
      this.stopTranscode(did);
    }
  }
}
