import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as readline from "node:readline";
import { EventEmitter } from "node:events";
import { getNativeBinaryPath } from "./build-guard.js";

export interface IceServerConfig {
  url: string;
  username?: string;
  password?: string;
}

export interface NativeSessionConfig {
  did: string;
  p2p_id?: string;
  init_string?: string;
  local_key?: string;
  token?: string;
  camera_ip?: string;
  camera_port?: number;
  rtsp_port: number;
  rtsp_path?: string;
  p2p_quality_channel?: number;
  ice_servers?: IceServerConfig[];
}

export class NativeMediaEngine extends EventEmitter {
  private static instance: NativeMediaEngine | null = null;
  private process: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private isReady = false;
  private pendingCommands: string[] = [];

  private constructor() {
    super();
  }

  public static getInstance(): NativeMediaEngine {
    if (!NativeMediaEngine.instance) {
      NativeMediaEngine.instance = new NativeMediaEngine();
    }
    return NativeMediaEngine.instance;
  }

  public get ready(): boolean {
    return this.isReady;
  }

  private pendingSnapshots: Map<
    string,
    { resolve: (b64: string) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  > = new Map();

  public start(): boolean {
    if (this.process) return true;

    const binPath = getNativeBinaryPath();
    if (!fs.existsSync(binPath)) {
      console.warn(`⚠️ [NativeEngine] Binary not found at ${binPath}`);
      return false;
    }

    try {
      this.process = spawn(binPath, [], {
        stdio: ["pipe", "pipe", "inherit"],
      });

      this.rl = readline.createInterface({
        input: this.process.stdout!,
        terminal: false,
      });

      this.rl.on("line", (line) => {
        if (!line.trim()) return;
        try {
          const msg = JSON.parse(line);
          this.handleEvent(msg);
        } catch {
          if (process.env.LOG_LEVEL === "debug") {
            console.debug(`[NativeEngine] ${line}`);
          }
        }
      });

      this.process.stdin?.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code !== "EPIPE" && err.code !== "ERR_STREAM_DESTROYED") {
          console.error(`❌ [NativeEngine] stdin error:`, err);
        }
      });

      this.process.on("exit", (code) => {
        console.log(`[NativeEngine] Process exited with code ${code}`);
        if (this.rl) {
          this.rl.close();
          this.rl = null;
        }
        this.process = null;
        this.isReady = false;
        this.emit("exit", code);
      });

      this.process.on("error", (err) => {
        console.error(`❌ [NativeEngine] Process error:`, err);
        if (this.rl) {
          this.rl.close();
          this.rl = null;
        }
        this.process = null;
        this.isReady = false;
        this.emit("error", err);
      });

      console.log(`🚀 [NativeEngine] Spawned C++ native engine (tuya-streamer) from ${binPath}`);
      return true;
    } catch (e) {
      console.error(`❌ [NativeEngine] Failed to spawn binary:`, e);
      return false;
    }
  }

  public restart(): void {
    this.stop();
    setTimeout(() => {
      this.start();
    }, 500);
  }

  private handleEvent(msg: Record<string, any>): void {
    if (msg.event === "ready") {
      this.isReady = true;
      this.emit("ready");
      for (const cmd of this.pendingCommands) {
        this.sendLine(cmd);
      }
      this.pendingCommands = [];
    } else if (msg.event === "webrtc_offer") {
      this.emit("webrtc_offer", msg.did, msg.sdp);
    } else if (msg.event === "webrtc_connected") {
      this.emit("webrtc_connected", msg.did);
    } else if (msg.event === "webrtc_disconnected") {
      this.emit("webrtc_disconnected", msg.did);
    } else if (msg.event === "ice_candidate") {
      this.emit("ice_candidate", msg.did, msg.candidate, msg.mid);
    } else if (msg.event === "p2p_connected") {
      this.emit("p2p_connected", msg.did, msg.ip, msg.port);
    } else if (msg.event === "session_ready") {
      this.emit("session_ready", msg.did);
    } else if (msg.event === "session_started") {
      this.emit("session_started", msg.did, msg.rtsp_port);
    } else if (msg.event === "keyframe") {
      this.emit("keyframe", msg.did);
    } else if (msg.event === "unhealthy") {
      this.emit("unhealthy", msg.did);
    } else if (msg.event === "viewer_offer") {
      this.emit(
        "viewer_offer",
        msg.viewer_id,
        msg.did,
        msg.sdp,
        msg.rtp_port,
        msg.audio_rtp_port,
      );
    } else if (msg.event === "viewer_state") {
      this.emit("viewer_state", msg.viewer_id, msg.did, msg.state);
    } else if (msg.event === "snapshot") {
      const pending = this.pendingSnapshots.get(msg.did);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingSnapshots.delete(msg.did);
        pending.resolve(typeof msg.data_base64 === "string" ? msg.data_base64 : "");
      }
    } else if (msg.event === "error") {
      const pending = this.pendingSnapshots.get(msg.did);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingSnapshots.delete(msg.did);
        pending.reject(new Error(String(msg.message ?? "native error")));
      }
    } else {
      this.emit(msg.event || "message", msg);
    }
  }

  public sendLine(line: string | object): void {
    const stdin = this.process?.stdin;
    if (!stdin || stdin.destroyed || stdin.writableEnded) return;
    const str = typeof line === "string" ? line : JSON.stringify(line);
    try {
      stdin.write(str + "\n", (err) => {
        if (err && (err as NodeJS.ErrnoException).code !== "EPIPE") {
          console.error(`❌ [NativeEngine] command write failed:`, err);
        }
      });
    } catch (err: any) {
      if (err?.code !== "EPIPE" && err?.code !== "ERR_STREAM_DESTROYED") throw err;
    }
  }

  private sendWhenReady(payload: object): void {
    const line = JSON.stringify(payload);
    if (this.isReady) {
      this.sendLine(line);
      return;
    }
    this.pendingCommands.push(line);
    if (!this.process) this.start();
  }

  public startP2P(config: NativeSessionConfig): void {
    const payload = JSON.stringify({
      cmd: "start_p2p",
      ...config,
    });

    if (this.isReady) {
      this.sendLine(payload);
    } else {
      this.pendingCommands.push(payload);
      if (!this.process) this.start();
    }
  }

  public requestKeyframe(did: string): void {
    const payload = JSON.stringify({
      cmd: "request_keyframe",
      did,
    });
    if (this.isReady) {
      this.sendLine(payload);
    }
  }

  public setQuality(did: string, channel: number): void {
    const payload = JSON.stringify({
      cmd: "set_quality",
      did,
      channel,
    });
    if (this.isReady) {
      this.sendLine(payload);
    }
  }

  public ptz(did: string, direction: string): void {
    const payload = JSON.stringify({
      cmd: "ptz",
      did,
      direction,
    });
    if (this.isReady) {
      this.sendLine(payload);
    }
  }

  public stopP2P(did: string): void {
    const payload = JSON.stringify({
      cmd: "stop_p2p",
      did,
    });
    if (this.isReady) {
      this.sendLine(payload);
    }
  }

  public getSnapshot(did: string, timeoutMs = 4000): Promise<string> {
    return new Promise((resolve, reject) => {
      const existing = this.pendingSnapshots.get(did);
      if (existing) clearTimeout(existing.timer);
      const timer = setTimeout(() => {
        this.pendingSnapshots.delete(did);
        reject(new Error("snapshot request timed out"));
      }, timeoutMs);
      this.pendingSnapshots.set(did, { resolve, reject, timer });
      this.sendLine({ cmd: "get_snapshot", did });
    });
  }

  public startH264Relay(
    did: string,
    rtspPort: number,
    rtspPath: string,
    rtpPort: number,
    audioRtpPort: number,
  ): void {
    this.sendWhenReady({
      cmd: "start_relay",
      did,
      rtsp_port: rtspPort,
      rtsp_path: rtspPath,
      rtp_port: rtpPort,
      audio_rtp_port: audioRtpPort,
    });
  }

  public stopH264Relay(did: string): void {
    this.sendLine({ cmd: "stop_relay", did });
  }

  public startViewer(viewerId: string, did: string, sdp: string): void {
    this.sendWhenReady({ cmd: "start_viewer", viewer_id: viewerId, did, sdp });
  }

  public stopViewer(viewerId: string, did: string): void {
    this.sendLine({ cmd: "stop_viewer", viewer_id: viewerId, did });
  }

  public stop(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this.process) {
      const proc = this.process;
      this.process = null;
      this.isReady = false;
      try {
        const stdin = proc.stdin;
        if (stdin && !stdin.destroyed && !stdin.writableEnded) {
          stdin.end(`${JSON.stringify({ cmd: "exit" })}\n`);
        }
        const killTimer = setTimeout(() => {
          try { proc.kill("SIGTERM"); } catch {}
        }, 750);
        killTimer.unref();
      } catch {
        try { proc.kill("SIGTERM"); } catch {}
      }
    }
  }
}
