import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import { Server, WebSocket } from "ws";
import { NativeMediaEngine } from "../engine/native-engine.js";
import { Logger } from "@nestjs/common";

@WebSocketGateway({ path: "/ws" })
export class AppWebSocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(AppWebSocketGateway.name);
  private engine = NativeMediaEngine.getInstance();
  private clients: Set<WebSocket> = new Set();

  afterInit() {
    this.engine.on("p2p_connected", (did, ip, port) => {
      this.broadcast({ event: "p2p_connected", did, ip, port });
    });

    this.engine.on("session_started", (did, rtspPort) => {
      this.broadcast({ event: "session_started", did, rtspPort });
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

    client.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "ping") {
          client.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
        }
      } catch {}
    });
  }

  handleDisconnect(client: WebSocket) {
    this.clients.delete(client);
    this.logger.log(`Client disconnected. Total clients: ${this.clients.size}`);
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
