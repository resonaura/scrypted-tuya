import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import { Server, WebSocket } from "ws";
import { NativeMediaEngine } from "../engine/native-engine.js";
import { Logger, OnModuleDestroy } from "@nestjs/common";
import * as dgram from "node:dgram";

interface TalkSession {
  did: string;
  port?: number;
  seq: number;
  timestamp: number;
  packetCount: number;
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

  constructor() {
    this.udpSocket.on("error", (err) => {
      this.logger.warn(`Talkback UDP socket error: ${err.message}`);
    });
  }

  afterInit() {
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
    client.send(JSON.stringify({ event: "welcome", timestamp: Date.now() }));

    client.on("message", (data: any, isBinary: boolean) => {
      // Determine if message is a JSON control command (starts with '{')
      const firstByte = Buffer.isBuffer(data)
        ? data[0]
        : typeof data === "string"
          ? data.charCodeAt(0)
          : 0;
      const isJsonText = !isBinary || firstByte === 0x7b; // 0x7b is '{'

      if (isJsonText) {
        try {
          const str = typeof data === "string" ? data : data.toString("utf8");
          if (str.startsWith("{")) {
            const msg = JSON.parse(str);
            if (msg.type === "ping") {
              client.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
              return;
            } else if (msg.type === "talk_start" && msg.did) {
              const port = this.engine.getTalkbackPort(msg.did);
              this.logger.log(
                `🎙️ [Talkback WS] Client started talk for ${msg.did}, talkback UDP port: ${port || "WAITING"}`,
              );
              this.activeTalkSessions.set(client, {
                did: msg.did,
                port,
                seq: Math.floor(Math.random() * 0x10000),
                timestamp: Math.floor(Math.random() * 0x10000000),
                packetCount: 0,
              });
              client.send(
                JSON.stringify({
                  type: "talk_ready",
                  did: msg.did,
                  ready: Boolean(port),
                }),
              );
              return;
            } else if (msg.type === "talk_audio" && msg.did && msg.data) {
              const buf = Buffer.from(msg.data, "base64");
              this.handleAudioData(client, buf);
              return;
            } else if (msg.type === "talk_stop") {
              this.logger.log(`🎙️ [Talkback WS] Client stopped talk`);
              this.activeTalkSessions.delete(client);
              return;
            }
          }
        } catch {}
      }

      // Otherwise, binary audio payload from real-time microphone stream
      this.handleAudioData(client, Buffer.isBuffer(data) ? data : Buffer.from(data));
    });
  }

  private handleAudioData(client: WebSocket, payload: Buffer): void {
    const session = this.activeTalkSessions.get(client);
    if (!session) return;
    if (!session.port) {
      session.port = this.engine.getTalkbackPort(session.did) || 0;
    }
    if (!session.port || payload.length === 0) return;

    // Wrap in 12-byte RTP header: PT=0, timestamp increment = audio samples count (8000Hz)
    const samples = Math.floor(payload.length / 2);
    const rtp = Buffer.alloc(12 + payload.length);
    rtp[0] = 0x80; // V=2, P=0, X=0, CC=0
    rtp[1] = 0x00; // M=0, PT=0 (Tuya negotiated audio PT)
    rtp.writeUInt16BE(session.seq & 0xffff, 2);
    session.seq = (session.seq + 1) & 0xffff;
    rtp.writeUInt32BE(session.timestamp >>> 0, 4);
    session.timestamp = (session.timestamp + (samples > 0 ? samples : payload.length)) >>> 0;
    rtp.writeUInt32BE(0x12345678, 8); // dummy SSRC, peer.cpp overrides with audio_send_ssrc_
    payload.copy(rtp, 12);

    this.udpSocket.send(rtp, session.port, "127.0.0.1", (err) => {
      if (err) this.logger.warn(`Failed to send talkback UDP: ${err.message}`);
    });

    session.packetCount++;
    if (session.packetCount === 1 || session.packetCount % 100 === 0) {
      this.logger.log(
        `🎙️ [Talkback WS] Forwarded ${session.packetCount} audio packets to camera ${session.did} (UDP port ${session.port})`,
      );
    }
  }

  handleDisconnect(client: WebSocket) {
    this.clients.delete(client);
    this.activeTalkSessions.delete(client);
    this.logger.log(`Client disconnected. Total clients: ${this.clients.size}`);
  }

  onModuleDestroy() {
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
