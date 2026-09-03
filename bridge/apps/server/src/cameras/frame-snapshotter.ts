import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";

export interface FrameSnapshotterOptions {
  slug: string;
  did: string;
  rtspUrl: string;
  dataDir: string;
  intervalMs?: number;
  maxConsecutiveFailures?: number;
  getSnapshot?: (did: string, timeoutMs?: number) => Promise<string>;
}

export class FrameSnapshotter extends EventEmitter {
  private proc: ChildProcess | null = null;
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private inFlight = false;
  private currentPath: string;
  private consecutiveFailures = 0;
  private lastBuffer: Buffer | null = null;

  public readonly slug: string;
  public readonly did: string;
  public readonly rtspUrl: string;
  public readonly dataDir: string;
  public readonly intervalMs: number;
  public readonly maxConsecutiveFailures: number;
  private readonly getSnapshot?: (did: string, timeoutMs?: number) => Promise<string>;

  constructor(options: FrameSnapshotterOptions) {
    super();
    this.slug = options.slug;
    this.did = options.did;
    this.rtspUrl = options.rtspUrl;
    this.dataDir = options.dataDir;
    this.intervalMs = options.intervalMs ?? 6000;
    this.maxConsecutiveFailures = options.maxConsecutiveFailures ?? 3;
    this.getSnapshot = options.getSnapshot;

    const framesDir = path.join(this.dataDir, "frames");
    if (!fs.existsSync(framesDir)) {
      fs.mkdirSync(framesDir, { recursive: true });
    }
    this.currentPath = path.join(framesDir, `${this.slug}.jpg`);
  }

  public get filePath(): string {
    return this.currentPath;
  }

  public getLatestBuffer(): Buffer | null {
    if (this.lastBuffer && this.lastBuffer.length > 0) {
      return this.lastBuffer;
    }
    try {
      if (fs.existsSync(this.currentPath)) {
        this.lastBuffer = fs.readFileSync(this.currentPath);
        return this.lastBuffer;
      }
    } catch {}
    return null;
  }

  public start(): void {
    this.stopped = false;
    // Initial quick grab after short warmup
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      if (!this.stopped) this.grabOnce().catch(() => {});
    }, 750);
    this.initialTimer.unref();

    this.timer = setInterval(() => {
      if (!this.stopped && !this.inFlight) {
        this.grabOnce().catch(() => {});
      }
    }, this.intervalMs);
    this.timer.unref();
  }

  public stop(): void {
    this.stopped = true;
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.proc) {
      try {
        this.proc.kill("SIGKILL");
      } catch {}
      this.proc = null;
    }
  }

  public async grabOnce(): Promise<boolean> {
    if (this.stopped || this.inFlight) return false;
    this.inFlight = true;

    if (this.getSnapshot) {
      const ok = await this.grabFromKeyframe();
      if (ok) {
        this.inFlight = false;
        this.consecutiveFailures = 0;
        return true;
      }
      // Fall back to the live RTSP stream. A missing cached IDR must not mark
      // the camera unhealthy or restart an otherwise working media session.
    }

    return new Promise((resolve) => {
      const tempPath = `${this.currentPath}.${Date.now()}.tmp.jpg`;
      const args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-rtsp_transport",
        "tcp",
        "-fflags",
        "+discardcorrupt+genpts",
        "-err_detect",
        "ignore_err",
        "-analyzeduration",
        "1500000",
        "-probesize",
        "1500000",
        "-i",
        this.rtspUrl,
        // Do not encode the first cached decode result. Waiting briefly lets
        // FFmpeg reach a complete fresh GOP instead of saving damaged slices.
        "-ss",
        "0.75",
        "-an",
        "-vf",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
        "-frames:v",
        "1",
        "-q:v",
        "3",
        "-y",
        tempPath,
      ];

      let proc: ChildProcess;
      try {
        proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
      } catch {
        this.inFlight = false;
        this.handleFailure();
        resolve(false);
        return;
      }

      this.proc = proc;

      const killTimer = setTimeout(() => {
        if (this.proc === proc) {
          try {
            proc.kill("SIGKILL");
          } catch {}
        }
      }, 8000);

      proc.on("exit", (code) => {
        clearTimeout(killTimer);
        if (this.proc === proc) this.proc = null;
        this.inFlight = false;

        if (code === 0 && fs.existsSync(tempPath)) {
          try {
            const buf = fs.readFileSync(tempPath);
            if (buf.length > 1000) {
              fs.renameSync(tempPath, this.currentPath);
              this.lastBuffer = buf;
              this.consecutiveFailures = 0;
              this.emit("frame", {
                slug: this.slug,
                did: this.did,
                buffer: buf,
              });
              resolve(true);
              return;
            }
          } catch {} finally {
            try { fs.unlinkSync(tempPath); } catch {}
          }
        }
        try { fs.unlinkSync(tempPath); } catch {}
        this.handleFailure();
        resolve(false);
      });

      proc.on("error", () => {
        clearTimeout(killTimer);
        if (this.proc === proc) this.proc = null;
        this.inFlight = false;
        try { fs.unlinkSync(tempPath); } catch {}
        this.handleFailure();
        resolve(false);
      });
    });
  }

  private async grabFromKeyframe(): Promise<boolean> {
    try {
      const b64 = await this.getSnapshot!(this.did, 4000);
      if (!b64) return false;
      const annexb = Buffer.from(b64, "base64");
      if (annexb.length < 64) return false;

      const tmpDir = this.currentPath.replace(/\.jpg$/, "");
      fs.mkdirSync(tmpDir, { recursive: true });
      const h265Path = path.join(tmpDir, `${Date.now()}.h265`);
      const jpgPath = h265Path.replace(/\.h265$/, ".jpg");
      fs.writeFileSync(h265Path, annexb);

      const ok = await this.decodeH265ToJpeg(h265Path, jpgPath);
      try { fs.unlinkSync(h265Path); } catch {}

      if (!ok || !fs.existsSync(jpgPath)) {
        try { fs.unlinkSync(jpgPath); } catch {}
        return false;
      }

      try {
        const buf = fs.readFileSync(jpgPath);
        if (buf.length < 1000) {
          try { fs.unlinkSync(jpgPath); } catch {}
          return false;
        }
        // Atomically replace the served snapshot file
        const swapPath = `${this.currentPath}.${Date.now()}.swap.jpg`;
        fs.writeFileSync(swapPath, buf);
        fs.renameSync(swapPath, this.currentPath);
        this.lastBuffer = buf;
        this.emit("frame", { slug: this.slug, did: this.did, buffer: buf });
        return true;
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }
    } catch {
      return false;
    }
  }

  private decodeH265ToJpeg(h265Path: string, jpgPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        h265Path,
        "-an",
        "-vf",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
        "-frames:v",
        "1",
        "-q:v",
        "3",
        "-y",
        jpgPath,
      ];
      let proc: ChildProcess;
      try {
        proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
      } catch {
        resolve(false);
        return;
      }
      const killTimer = setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch {}
      }, 8000);
      proc.on("exit", (code) => {
        clearTimeout(killTimer);
        resolve(code === 0);
      });
      proc.on("error", () => {
        clearTimeout(killTimer);
        resolve(false);
      });
    });
  }

  private handleFailure(): void {
    this.consecutiveFailures++;
    this.emit("failure", {
      did: this.did,
      slug: this.slug,
      count: this.consecutiveFailures,
      max: this.maxConsecutiveFailures,
    });
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      this.emit("unhealthy", { did: this.did, slug: this.slug });
    }
  }
}
