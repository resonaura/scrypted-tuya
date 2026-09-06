import { forwardRef, Inject, Logger, OnModuleDestroy } from "@nestjs/common";
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import * as dgram from "node:dgram";
import { Server, WebSocket } from "ws";
import { NativeMediaEngine } from "../engine/native-engine.js";
import {
  buildTalkbackRtp,
  encodeDacUlawFromS16le,
  TALKBACK_S16_BYTES,
  TALKBACK_TS_INCREMENT,
} from "../streaming/talkback-dac.js";
import {
  TalkbackSessionService,
  type TalkbackPublicState,
} from "../streaming/talkback-session.service.js";

interface TalkSession {
  did: string;
  ownerId: string;
  port?: number;
  seq: number;
  timestamp: number;
  packetCount: number;
  pcmRemainder: Buffer;
}

@WebSocketGateway({ path: "/ws" })
export class AppWebSocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(AppWebSocketGateway.name);
  private engine = NativeMediaEngine.getInstance();
  private clients: Set<WebSocket> = new Set();
  private activeTalkSessions: Map<WebSocket, TalkSession> = new Map();
  private udpSocket: dgram.Socket = dgram.createSocket("udp4");
  private nextOwner = 1;
  private ownerOf = new WeakMap<WebSocket, string>();

  constructor(
    @Inject(forwardRef(() => TalkbackSessionService))
    private readonly talkback: TalkbackSessionService,
  ) {
    this.udpSocket.on("error", (err) => {
      this.logger.warn(`Talkback UDP socket error: ${err.message}`);
    });
  }

  afterInit() {
    this.talkback.on("state", (state: TalkbackPublicState) => {
      this.broadcast({ event: "talk_state", ...state });
      if (state.holder !== "web") {
        this.dropWebSessions(state.did, "preempted");
      }
    });

    this.engine.on("p2p_connected", (did, ip, port) => {
      this.broadcast({ event: "p2p_connected", did, ip, port });
    });

    this.engine.on("session_started", (did, rtspPort, talkbackPort) => {
      this.broadcast({ event: "session_started", did, rtspPort });
      if (talkbackPort) {
        for (const session of this.activeTalkSessions.values()) {
          if (session.did === did) {
            session.port = talkbackPort;
          }
        }
      }
    });

    this.engine.on("keyframe", (did) => {
      this.broadcast({ event: "keyframe", did });
    });

    this.engine.on("unhealthy", (did) => {
      this.broadcast({ event: "unhealthy", did });
    });
  }

  handleConnection(client: WebSocket) {
    this.clients.add(client);
    this.logger.log(`Client connected. Total clients: ${this.clients.size}`);
    client.send(
      JSON.stringify({
        event: "welcome",
        timestamp: Date.now(),
        talk: this.talkback.snapshot(),
      }),
    );

    client.on("message", (data: any, isBinary: boolean) => {
      const firstByte = Buffer.isBuffer(data)
        ? data[0]
        : typeof data === "string"
          ? data.charCodeAt(0)
          : 0;
      const isJsonText = !isBinary || firstByte === 0x7b;

      if (isJsonText) {
        try {
          const str = typeof data === "string" ? data : data.toString("utf8");
          if (str.startsWith("{")) {
            const msg = JSON.parse(str);
            if (msg.type === "ping") {
              client.send(
                JSON.stringify({ type: "pong", timestamp: Date.now() }),
              );
              return;
            } else if (msg.type === "talk_start" && msg.did) {
              this.startTalk(client, msg.did);
              return;
            } else if (msg.type === "talk_audio" && msg.did && msg.data) {
              const buf = Buffer.from(msg.data, "base64");
              this.handleAudioData(client, buf);
              return;
            } else if (msg.type === "talk_stop") {
              this.stopTalk(client);
              return;
            }
          }
        } catch {}
      }

      this.handleAudioData(
        client,
        Buffer.isBuffer(data) ? data : Buffer.from(data),
      );
    });
  }

  private ownerId(client: WebSocket): string {
    let id = this.ownerOf.get(client);
    if (!id) {
      id = `web-${this.nextOwner++}`;
      this.ownerOf.set(client, id);
    }
    return id;
  }

  private startTalk(client: WebSocket, did: string): void {
    const existing = this.activeTalkSessions.get(client);
    if (existing) {
      this.talkback.release(existing.did, "web", existing.ownerId);
      this.activeTalkSessions.delete(client);
    }

    const ownerId = this.ownerId(client);
    const result = this.talkback.claim(did, "web", ownerId);
    if (!result.ok) {
      this.logger.log(
        `🎙️ [Talkback WS] talk_start denied for ${did} (holder=${result.holder})`,
      );
      client.send(
        JSON.stringify({
          type: "talk_busy",
          did,
          holder: result.holder,
        }),
      );
      return;
    }

    const port = this.engine.getTalkbackPort(did);
    this.logger.log(
      `🎙️ [Talkback WS] Client started talk for ${did}, talkback UDP port: ${port || "WAITING"}`,
    );
    this.activeTalkSessions.set(client, {
      did,
      ownerId,
      port,
      seq: Math.floor(Math.random() * 0x10000),
      timestamp: Math.floor(Math.random() * 0x10000000),
      packetCount: 0,
      pcmRemainder: Buffer.alloc(0),
    });
    client.send(
      JSON.stringify({
        type: "talk_ready",
        did,
        ready: Boolean(port),
      }),
    );
  }

  private stopTalk(client: WebSocket): void {
    const session = this.activeTalkSessions.get(client);
    if (!session) return;
    this.logger.log(`🎙️ [Talkback WS] Client stopped talk ${session.did}`);
    this.activeTalkSessions.delete(client);
    this.talkback.release(session.did, "web", session.ownerId);
  }

  private dropWebSessions(did: string, reason: string): void {
    for (const [client, session] of this.activeTalkSessions) {
      if (session.did !== did) continue;
      this.activeTalkSessions.delete(client);
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(JSON.stringify({ type: "talk_end", did, reason }));
        } catch {}
      }
    }
  }

  private handleAudioData(client: WebSocket, payload: Buffer): void {
    const session = this.activeTalkSessions.get(client);
    if (!session) return;
    if (!session.port) {
      session.port = this.engine.getTalkbackPort(session.did) || 0;
    }
    if (payload.length === 0) return;

    session.pcmRemainder = Buffer.concat([session.pcmRemainder, payload]);

    while (session.pcmRemainder.length >= TALKBACK_S16_BYTES) {
      const s16 = session.pcmRemainder.subarray(0, TALKBACK_S16_BYTES);
      session.pcmRemainder = session.pcmRemainder.subarray(
        TALKBACK_S16_BYTES,
      );

      if (!this.talkback.shouldSend(session.did, "web")) continue;

      const frame = encodeDacUlawFromS16le(s16);
      this.talkback.touch(session.did, "web");

      if (!session.port) continue;

      const rtp = buildTalkbackRtp(frame, session.seq, session.timestamp);
      session.seq = (session.seq + 1) & 0xffff;
      session.timestamp = (session.timestamp + TALKBACK_TS_INCREMENT) >>> 0;

      this.udpSocket.send(rtp, session.port, "127.0.0.1", (err) => {
        if (err)
          this.logger.warn(`Failed to send talkback UDP: ${err.message}`);
      });

      session.packetCount++;
      if (session.packetCount === 1 || session.packetCount % 100 === 0) {
        this.logger.log(
          `🎙️ [Talkback WS] DAC μ-law ${session.packetCount} pkts ${session.did} udp ${session.port}`,
        );
      }
    }
  }

  handleDisconnect(client: WebSocket) {
    this.clients.delete(client);
    this.stopTalk(client);
    this.logger.log(`Client disconnected. Total clients: ${this.clients.size}`);
  }

  onModuleDestroy() {
    for (const client of [...this.activeTalkSessions.keys()]) {
      this.stopTalk(client);
    }
    try {
      this.udpSocket.close();
    } catch {}
  }

  public broadcast(payload: Record<string, any>) {
    const data = JSON.stringify(payload);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }
}
