import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { EventEmitter } from "node:events";
import * as net from "node:net";
import * as dgram from "node:dgram";
import { spawn, type ChildProcess } from "node:child_process";
import { env } from "../config/env.js";
import { CameraEntity } from "../db/entities/index.js";
import { cameraSlug } from "../utils/camera-slug.js";
import { NativeMediaEngine } from "../engine/native-engine.js";

const HANDSHAKE = 1536;
const MSG_SET_CHUNK = 1;
const MSG_AUDIO = 8;
const MSG_COMMAND = 20;

export interface RtmpPublishEvent {
  name: string;
  app: string;
}

export interface RtmpAudioEvent {
  name: string;
  payload: Buffer;
  timestamp: number;
}

export class RTMPIngestServer extends EventEmitter {
  private server: net.Server | null = null;
  private port: number;
  private connections = new Set<RtmpConnection>();

  constructor(port: number = 1935) {
    super();
    this.port = port;
  }

  public get listenPort(): number {
    return this.port;
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.accept(socket));
      this.server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          this.port += 1;
          this.server!.listen(this.port);
          return;
        }
        reject(err);
      });
      this.server.listen(this.port, () => {
        this.emit("listening", this.port);
        resolve();
      });
    });
  }

  public stop(): void {
    for (const c of this.connections) c.close();
    this.connections.clear();
    this.server?.close();
    this.server = null;
  }

  private accept(socket: net.Socket): void {
    const conn = new RtmpConnection(socket);
    this.connections.add(conn);
    conn.on("publish", (ev: RtmpPublishEvent) => this.emit("publish", ev));
    conn.on("audio", (ev: RtmpAudioEvent) => this.emit("audio", ev));
    conn.on("unpublish", (ev: RtmpPublishEvent) => this.emit("unpublish", ev));
    socket.on("close", () => this.connections.delete(conn));
    socket.on("error", () => this.connections.delete(conn));
  }
}

class RtmpConnection extends EventEmitter {
  private socket: net.Socket;
  private buf = Buffer.alloc(0);
  private stage: "c0c1" | "c2" | "chunk" = "c0c1";
  private s1 = Buffer.alloc(HANDSHAKE);
  private inChunkSize = 128;
  private outChunkSize = 4096;
  private chunks = new Map<
    number,
    {
      timestamp: number;
      len: number;
      type: number;
      streamId: number;
      payload: Buffer;
    }
  >();
  private transId = 1;
  private streamName = "";
  private app = "talk";
  private published = false;

  constructor(socket: net.Socket) {
    super();
    this.socket = socket;
    socket.on("data", (d) => this.onData(d));
    socket.on("close", () => this.teardown());
    socket.on("error", () => this.teardown());
  }

  public close(): void {
    try {
      this.socket.destroy();
    } catch {}
    this.teardown();
  }

  private teardown(): void {
    if (this.published && this.streamName) {
      this.published = false;
      this.emit("unpublish", { name: this.streamName, app: this.app });
    }
  }

  private onData(data: Buffer): void {
    this.buf = Buffer.concat([this.buf, data]);
    if (this.stage === "c0c1") {
      if (this.buf.length < 1 + HANDSHAKE) return;
      const c1 = this.buf.subarray(1, 1 + HANDSHAKE);
      this.buf = this.buf.subarray(1 + HANDSHAKE);
      this.s1.writeUInt32BE((Date.now() / 1000) >>> 0, 0);
      const s0s1s2 = Buffer.concat([Buffer.from([3]), this.s1, c1]);
      this.socket.write(s0s1s2);
      this.stage = "c2";
    }
    if (this.stage === "c2") {
      if (this.buf.length < HANDSHAKE) return;
      this.buf = this.buf.subarray(HANDSHAKE);
      this.stage = "chunk";
    }
    if (this.stage === "chunk") {
      while (this.consumeChunk()) {}
    }
  }

  private consumeChunk(): boolean {
    if (this.buf.length < 1) return false;
    const fmt = (this.buf[0] >> 6) & 0x03;
    let csId = this.buf[0] & 0x3f;
    let hdrLen = 1;
    if (csId === 0) {
      if (this.buf.length < 2) return false;
      csId = 64 + this.buf[1];
      hdrLen = 2;
    } else if (csId === 1) {
      if (this.buf.length < 3) return false;
      csId = 64 + this.buf[1] + (this.buf[2] << 8);
      hdrLen = 3;
    }

    const prev = this.chunks.get(csId);
    let msgLen = prev?.len ?? 0;
    let msgType = prev?.type ?? 0;
    let streamId = prev?.streamId ?? 0;
    let ts = prev?.timestamp ?? 0;
    let extra = 0;

    if (fmt === 0) {
      if (this.buf.length < hdrLen + 11) return false;
      const h = this.buf.subarray(hdrLen, hdrLen + 11);
      ts = (h[0] << 16) | (h[1] << 8) | h[2];
      msgLen = (h[3] << 16) | (h[4] << 8) | h[5];
      msgType = h[6];
      streamId = h.readUInt32LE(7);
      extra = 11;
    } else if (fmt === 1) {
      if (this.buf.length < hdrLen + 7) return false;
      const h = this.buf.subarray(hdrLen, hdrLen + 7);
      ts = (h[0] << 16) | (h[1] << 8) | h[2];
      msgLen = (h[3] << 16) | (h[4] << 8) | h[5];
      msgType = h[6];
      extra = 7;
    } else if (fmt === 2) {
      if (this.buf.length < hdrLen + 3) return false;
      const h = this.buf.subarray(hdrLen, hdrLen + 3);
      ts = (h[0] << 16) | (h[1] << 8) | h[2];
      extra = 3;
    } else {
      extra = 0;
    }

    let timestamp = ts;
    if (ts === 0xffffff) {
      if (this.buf.length < hdrLen + extra + 4) return false;
      timestamp = this.buf.readUInt32BE(hdrLen + extra);
      extra += 4;
    }

    const have = prev?.payload.length ?? 0;
    const remaining = msgLen - have;
    const take = Math.min(this.inChunkSize, remaining);
    if (this.buf.length < hdrLen + extra + take) return false;

    const piece = this.buf.subarray(hdrLen + extra, hdrLen + extra + take);
    this.buf = this.buf.subarray(hdrLen + extra + take);
    const payload = Buffer.concat([prev?.payload ?? Buffer.alloc(0), piece]);
    this.chunks.set(csId, {
      timestamp,
      len: msgLen,
      type: msgType,
      streamId,
      payload,
    });

    if (payload.length >= msgLen) {
      this.chunks.set(csId, {
        timestamp,
        len: msgLen,
        type: msgType,
        streamId,
        payload: Buffer.alloc(0),
      });
      this.onMessage(msgType, payload.subarray(0, msgLen), streamId, timestamp);
    }
    return true;
  }

  private onMessage(type: number, payload: Buffer, streamId: number, timestamp: number): void {
    if (type === MSG_SET_CHUNK && payload.length >= 4) {
      this.inChunkSize = payload.readUInt32BE(0) || this.inChunkSize;
      return;
    }
    if (type === MSG_COMMAND) {
      const args = decodeAmf0List(payload);
      const cmd = String(args[0] || "");
      const tx = Number(args[1] || 0);
      if (cmd === "connect") {
        const obj = (args[2] || {}) as Record<string, unknown>;
        this.app = String(obj.app || "talk").replace(/\/$/, "");
        this.sendWindowAck(5000000);
        this.sendPeerBandwidth(5000000);
        this.sendUserControl(0, 0);
        this.sendChunkSize(4096);
        this.sendCommand(
          "_result",
          tx,
          { fmsVer: "FMS/3,0,1,123", capabilities: 31 },
          {
            level: "status",
            code: "NetConnection.Connect.Success",
            description: "ok",
          },
        );
      } else if (cmd === "releaseStream") {
        this.sendCommand("_result", tx, null, null);
      } else if (cmd === "FCPublish") {
        this.sendCommand("onFCPublish", tx, null, { code: "NetStream.Publish.Start", description: "ok" });
      } else if (cmd === "createStream") {
        this.sendCommand("_result", tx, null, 1);
      } else if (cmd === "publish") {
        this.streamName = String(args[3] || args[4] || "stream");
        this.sendUserControl(0, 1);
        this.sendOnStatus(streamId, "NetStream.Publish.Start", `Publishing ${this.streamName}`);
        this.published = true;
        this.emit("publish", { name: this.streamName, app: this.app });
      } else if (cmd === "FCUnpublish" || cmd === "deleteStream" || cmd === "closeStream") {
        this.teardown();
      }
      return;
    }
    if (type === MSG_AUDIO) {
      this.emit("audio", { name: this.streamName, payload, timestamp });
    }
  }

  private sendWindowAck(size: number): void {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(size, 0);
    this.sendMessage(2, 5, 0, b);
  }

  private sendPeerBandwidth(size: number): void {
    const b = Buffer.alloc(5);
    b.writeUInt32BE(size, 0);
    b[4] = 2; // dynamic
    this.sendMessage(2, 6, 0, b);
  }

  private sendUserControl(event: number, value: number): void {
    const b = Buffer.alloc(6);
    b.writeUInt16BE(event, 0);
    b.writeUInt32BE(value, 2);
    this.sendMessage(2, 4, 0, b);
  }

  private sendChunkSize(size: number): void {
    this.outChunkSize = size;
    const b = Buffer.alloc(4);
    b.writeUInt32BE(size, 0);
    this.sendMessage(2, MSG_SET_CHUNK, 0, b);
  }

  private sendCommand(cmd: string, tx: number, ...rest: unknown[]): void {
    const payload = encodeAmf0List([cmd, tx, ...rest]);
    this.sendMessage(3, MSG_COMMAND, 0, payload);
  }

  private sendOnStatus(streamId: number, code: string, description: string): void {
    const payload = encodeAmf0List(["onStatus", 0, null, { level: "status", code, description }]);
    this.sendMessage(4, MSG_COMMAND, streamId, payload);
  }

  private sendMessage(csId: number, type: number, streamId: number, payload: Buffer): void {
    const hdr = Buffer.alloc(12);
    hdr[0] = csId & 0x3f;
    hdr[3] = 0;
    hdr[4] = (payload.length >> 16) & 0xff;
    hdr[5] = (payload.length >> 8) & 0xff;
    hdr[6] = payload.length & 0xff;
    hdr[7] = type;
    hdr.writeUInt32LE(streamId, 8);
    const chunks: Buffer[] = [hdr];
    let off = 0;
    const size = this.outChunkSize;
    while (off < payload.length) {
      if (off > 0) chunks.push(Buffer.from([0xc0 | (csId & 0x3f)]));
      const n = Math.min(size, payload.length - off);
      chunks.push(payload.subarray(off, off + n));
      off += n;
    }
    try {
      this.socket.write(Buffer.concat(chunks));
    } catch {}
    this.transId++;
  }
}

function encodeAmf0List(values: unknown[]): Buffer {
  return Buffer.concat(values.map(encodeAmf0));
}

function encodeAmf0(value: unknown): Buffer {
  if (value === null) return Buffer.from([0x05]);
  if (typeof value === "number") {
    const b = Buffer.alloc(9);
    b[0] = 0x00;
    b.writeDoubleBE(value, 1);
    return b;
  }
  if (typeof value === "boolean") {
    return Buffer.from([0x01, value ? 1 : 0]);
  }
  if (typeof value === "string") {
    const s = Buffer.from(value, "utf8");
    const b = Buffer.alloc(3 + s.length);
    b[0] = 0x02;
    b.writeUInt16BE(s.length, 1);
    s.copy(b, 3);
    return b;
  }
  if (typeof value === "object") {
    const parts: Buffer[] = [Buffer.from([0x03])];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = Buffer.from(k, "utf8");
      const kb = Buffer.alloc(2 + key.length);
      kb.writeUInt16BE(key.length, 0);
      key.copy(kb, 2);
      parts.push(kb, encodeAmf0(v));
    }
    parts.push(Buffer.from([0x00, 0x00, 0x09]));
    return Buffer.concat(parts);
  }
  return Buffer.from([0x05]);
}

function decodeAmf0List(buf: Buffer): unknown[] {
  const out: unknown[] = [];
  let off = 0;
  while (off < buf.length) {
    const r = decodeAmf0(buf, off);
    if (!r) break;
    out.push(r.value);
    off = r.off;
  }
  return out;
}

function decodeAmf0(buf: Buffer, off: number): { value: unknown; off: number } | null {
  if (off >= buf.length) return null;
  const t = buf[off++];
  if (t === 0x00) {
    if (off + 8 > buf.length) return null;
    return { value: buf.readDoubleBE(off), off: off + 8 };
  }
  if (t === 0x01) {
    if (off >= buf.length) return null;
    return { value: buf[off] !== 0, off: off + 1 };
  }
  if (t === 0x02) {
    if (off + 2 > buf.length) return null;
    const n = buf.readUInt16BE(off);
    off += 2;
    if (off + n > buf.length) return null;
    return { value: buf.subarray(off, off + n).toString("utf8"), off: off + n };
  }
  if (t === 0x03 || t === 0x08) {
    if (t === 0x08) off += 4;
    const obj: Record<string, unknown> = {};
    while (off + 2 <= buf.length) {
      const n = buf.readUInt16BE(off);
      off += 2;
      if (n === 0 && buf[off] === 0x09) {
        off += 1;
        break;
      }
      if (off + n > buf.length) break;
      const key = buf.subarray(off, off + n).toString("utf8");
      off += n;
      const r = decodeAmf0(buf, off);
      if (!r) break;
      obj[key] = r.value;
      off = r.off;
    }
    return { value: obj, off };
  }
  if (t === 0x05 || t === 0x06) return { value: null, off };
  if (t === 0x0a) {
    if (off + 4 > buf.length) return null;
    const n = buf.readUInt32BE(off);
    off += 4;
    const arr: unknown[] = [];
    for (let i = 0; i < n; i++) {
      const r = decodeAmf0(buf, off);
      if (!r) break;
      arr.push(r.value);
      off = r.off;
    }
    return { value: arr, off };
  }
  return { value: null, off: buf.length };
}

@Injectable()
export class RtmpService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RtmpService.name);
  private rtmpServer: RTMPIngestServer | null = null;
  private activeRelays = new Map<
    string,
    {
      proc: ChildProcess;
      port: number;
      did: string;
      udpSocket: dgram.Socket;
      seq: number;
      timestamp: number;
      pcmRemainder: Buffer;
    }
  >();

  async onModuleInit() {
    try {
      this.rtmpServer = new RTMPIngestServer(env.RTMP_PORT);
      await this.rtmpServer.start();
      this.logger.log(`🎙️ [RTMP Ingest] Listening on port ${this.rtmpServer.listenPort}`);

      this.rtmpServer.on("publish", async ({ name }: RtmpPublishEvent) => {
        const cam = await this.resolveCamera(name);
        if (!cam) {
          this.logger.warn(`🎙️ [Talkback RTMP] Publisher connected for stream "${name}" but no matching camera found`);
          return;
        }

        const talkbackPort = NativeMediaEngine.getInstance().getTalkbackPort(cam.did);
        this.logger.log(`🎙️ [Talkback RTMP] Publisher connected for "${name}" -> ${cam.name} (${cam.did}), talkback UDP: ${talkbackPort || "NONE"}`);
        if (talkbackPort) {
          this.startRelay(name, cam.did, talkbackPort);
        } else {
          this.logger.warn(`🎙️ [Talkback RTMP] Camera ${cam.name} does not have an active talkback UDP port yet`);
        }
      });

      this.rtmpServer.on("audio", ({ name, payload, timestamp }: RtmpAudioEvent) => {
        const relay = this.activeRelays.get(name);
        if (!relay || !relay.proc.stdin?.writable) return;

        try {
          const tagHdr = Buffer.alloc(11);
          tagHdr[0] = 0x08; // Audio
          tagHdr[1] = (payload.length >> 16) & 0xff;
          tagHdr[2] = (payload.length >> 8) & 0xff;
          tagHdr[3] = payload.length & 0xff;
          tagHdr[4] = (timestamp >> 16) & 0xff;
          tagHdr[5] = (timestamp >> 8) & 0xff;
          tagHdr[6] = timestamp & 0xff;
          tagHdr[7] = (timestamp >> 24) & 0xff;
          tagHdr[8] = 0;
          tagHdr[9] = 0;
          tagHdr[10] = 0;

          const prevTagSize = Buffer.alloc(4);
          prevTagSize.writeUInt32BE(payload.length + 11, 0);

          relay.proc.stdin.write(Buffer.concat([tagHdr, payload, prevTagSize]));
        } catch (err: any) {
          this.logger.warn(`🎙️ [Talkback RTMP] Failed to write audio tag: ${err.message}`);
        }
      });

      this.rtmpServer.on("unpublish", async ({ name }: RtmpPublishEvent) => {
        this.logger.log(`🎙️ [Talkback RTMP] Publisher disconnected from "${name}"`);
        this.stopRelay(name);
      });
    } catch (err: any) {
      this.logger.error(`❌ [RTMP Ingest] Failed to start: ${err.message}`);
    }
  }

  private startRelay(streamName: string, did: string, port: number): void {
    this.stopRelay(streamName);

    this.logger.log(`🎙️ [Talkback RTMP] Spawning audio transcoder (FLV pipe -> Raw PCM_S16LE 8kHz mono) -> 127.0.0.1:${port}`);

    const proc = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel", "warning",
      "-use_wallclock_as_timestamps", "1",
      "-f", "flv",
      "-i", "pipe:0",
      "-vn",
      "-filter:a", "volume=0.85,aresample=async=1000",
      "-c:a", "pcm_s16le",
      "-ar", "8000",
      "-ac", "1",
      "-f", "s16le",
      "pipe:1"
    ], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    const udpSocket = dgram.createSocket("udp4");
    const relayState = {
      proc,
      port,
      did,
      udpSocket,
      seq: Math.floor(Math.random() * 0x10000),
      timestamp: Math.floor(Math.random() * 0x10000000),
      pcmRemainder: Buffer.alloc(0),
    };

    // Frame size for 8000Hz mono 16-bit PCM: 20ms = 160 samples = 320 bytes
    const FRAME_SIZE = 320;

    proc.stdout?.on("data", (chunk: Buffer) => {
      relayState.pcmRemainder = Buffer.concat([relayState.pcmRemainder, chunk]);
      while (relayState.pcmRemainder.length >= FRAME_SIZE) {
        const frame = relayState.pcmRemainder.subarray(0, FRAME_SIZE);
        relayState.pcmRemainder = relayState.pcmRemainder.subarray(FRAME_SIZE);

        const rtp = Buffer.alloc(12 + FRAME_SIZE);
        rtp[0] = 0x80; // V=2, P=0, X=0, CC=0
        rtp[1] = 0x00; // PT=0 (PCMU/8000 slot used by camera)
        rtp.writeUInt16BE(relayState.seq & 0xffff, 2);
        relayState.seq = (relayState.seq + 1) & 0xffff;
        rtp.writeUInt32BE(relayState.timestamp >>> 0, 4);
        relayState.timestamp = (relayState.timestamp + 160) >>> 0;
        rtp.writeUInt32BE(0x12345678, 8); // dummy SSRC, peer.cpp overrides with audio_send_ssrc_
        frame.copy(rtp, 12);

        try {
          udpSocket.send(rtp, port, "127.0.0.1");
        } catch {}
      }
    });

    proc.stdin?.on("error", () => {});
    proc.on("error", (err) => {
      this.logger.error(`🎙️ [Talkback RTMP] FFmpeg relay error: ${err.message}`);
    });
    proc.on("exit", (code) => {
      this.logger.log(`🎙️ [Talkback RTMP] FFmpeg relay exited with code ${code}`);
      this.stopRelay(streamName);
    });

    // Write FLV header (9 bytes) + PreviousTagSize0 (4 bytes)
    const flvHeader = Buffer.from([
      0x46, 0x4c, 0x56, // 'FLV'
      0x01,             // version 1
      0x04,             // audio only flag
      0x00, 0x00, 0x00, 0x09, // header size 9
      0x00, 0x00, 0x00, 0x00, // PreviousTagSize0
    ]);
    try {
      proc.stdin?.write(flvHeader);
    } catch {}

    this.activeRelays.set(streamName, relayState);
  }

  private stopRelay(streamName: string): void {
    const relay = this.activeRelays.get(streamName);
    if (!relay) return;
    this.activeRelays.delete(streamName);
    try {
      relay.proc.stdout?.removeAllListeners();
    } catch {}
    try {
      relay.proc.stdin?.end();
    } catch {}
    try {
      relay.proc.kill("SIGTERM");
    } catch {}
    try {
      relay.udpSocket.close();
    } catch {}
  }

  onModuleDestroy() {
    for (const [name] of this.activeRelays) {
      this.stopRelay(name);
    }
    this.rtmpServer?.stop();
    this.rtmpServer = null;
  }

  public get listenPort(): number {
    return this.rtmpServer?.listenPort || env.RTMP_PORT;
  }

  private async resolveCamera(target: string): Promise<CameraEntity | null> {
    const raw = target.toLowerCase().trim();
    const cameras = await CameraEntity.find();
    return (
      cameras.find(
        (c) =>
          c.did.toLowerCase() === raw ||
          cameraSlug(c.name, c.did) === raw ||
          c.name.toLowerCase().includes(raw),
      ) || null
    );
  }
}
