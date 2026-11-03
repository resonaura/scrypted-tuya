import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { CameraBridgeProvider } from "@haus/bridge/provider";
import { CameraBridgeHttp } from "@haus/bridge/http";
import { advertiseCameraBridge } from "@haus/bridge/discovery";
import { CamerasService } from "./cameras.service.js";
import { getDataDir } from "./offline-card.js";
import { cameraSlug } from "../utils/camera-slug.js";
import { env } from "../config/env.js";

@Injectable()
export class HausNativeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HausNativeService.name);
  private provider?: CameraBridgeProvider;
  private http?: CameraBridgeHttp;
  private stopAdvertisement?: () => void;
  private pending?: Promise<void>;
  constructor(
    @Inject(CamerasService) private readonly cameras: CamerasService,
  ) {}
  async onModuleInit() {
    this.provider = await new CameraBridgeProvider({
      directory: join(getDataDir(), "haus"),
      provider: "tuya",
      name: "Tuya Camera Bridge",
      disableMqttWithHaus: process.env.DISABLE_MQTT_WITH_HAUS !== "false",
    }).initialize();
    this.http = new CameraBridgeHttp({
      provider: this.provider,
      command: async () => {
        throw Error("No writable native camera property is advertised");
      },
    });
    await this.refresh();
    try {
      this.stopAdvertisement = advertiseCameraBridge(
        this.provider.info(),
        env.PORT,
        () =>
          this.logger.warn(
            "Local discovery unavailable; use the bridge address",
          ),
      );
    } catch {
      this.logger.warn("Local discovery unavailable; use the bridge address");
    }
  }
  private host() {
    if (
      env.RTSP_HOST &&
      env.RTSP_HOST !== "localhost" &&
      !env.RTSP_HOST.startsWith("127.")
    )
      return env.RTSP_HOST;
    const addresses = Object.values(networkInterfaces())
      .flatMap((items) => items ?? [])
      .filter(
        (item) =>
          !item.internal &&
          isIP(item.address) === 4 &&
          /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address),
      );
    return (
      addresses.find((item) => !/^172\.(17|18|30)\./.test(item.address))
        ?.address ?? addresses[0]?.address
    );
  }
  private async refresh() {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const host = this.host();
      if (!host) throw Error("No private camera bridge address");
      const cameras = await this.cameras.getAll();
      const entries = await Promise.all(
        cameras.map(async (camera) => {
          const slug = cameraSlug(camera.name, camera.did),
            stamp = await stat(
              join(getDataDir(), "frames", slug + ".haus_live.jpg"),
            )
              .then((info) => info.mtimeMs)
              .catch(() => 0);
          return {
            id: camera.id,
            name: camera.name,
            manufacturer: "Tuya",
            model: camera.productId || camera.category || "Camera",
            identifiers: [camera.did],
            available: camera.online && Date.now() - stamp < 30000,
            stream: {
              url: `rtsp://${host.includes(":") ? "[" + host + "]" : host}:${camera.rtspPort || env.RTSP_BASE_PORT}/${camera.rtspPath || "live/" + slug}`,
              transport: "p2p" as const,
            },
            snapshotPath: `/api/cameras/${encodeURIComponent(camera.id)}/snapshot/last-live`,
            entities: [],
          };
        }),
      );
      this.provider!.updateInventory({
        version: 2,
        provider: "tuya",
        bridgeId: this.provider!.id,
        cameras: entries,
      });
    })().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  async handle(req: IncomingMessage, res: ServerResponse) {
    if (!this.http || !this.provider) {
      res.writeHead(503).end();
      return;
    }
    if (req.url === "/api/haus/v2/pairing" && req.method === "POST") {
      const address = req.socket.remoteAddress?.replace(/^::ffff:/, "");
      if (
        !["127.0.0.1", "::1"].includes(address ?? "") ||
        req.headers.origin ||
        req.headers["x-haus-client"] !== "1"
      ) {
        res.writeHead(403).end();
        return;
      }
      res
        .writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        })
        .end(JSON.stringify(this.provider.openPairing()));
      return;
    }
    try {
      await this.refresh();
      if (!(await this.http.handle(req, res))) res.writeHead(404).end();
    } catch {
      if (!res.headersSent) res.writeHead(503);
      res.end();
    }
  }
  async onModuleDestroy() {
    this.stopAdvertisement?.();
    await this.provider?.stop();
  }
}
