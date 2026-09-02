import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { CameraEntity } from "../db/entities/index.js";
import { NativeMediaEngine } from "../engine/native-engine.js";
import { TuyaProtectService } from "../auth/tuya-protect.service.js";
import { TuyaMqttService } from "../auth/tuya-mqtt.service.js";
import { TranscoderService } from "../streaming/transcoder.service.js";
import {
  OfflineCardManager,
  generateOfflineCardImage,
  getDataDir,
} from "./offline-card.js";
import { findFreePortRange, isPortAllowed } from "../utils/ports.js";
import { env } from "../config/env.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fsPromises from "node:fs/promises";
import type { CreateCameraDto, PtzDto } from "./dto.js";

const execAsync = promisify(exec);

@Injectable()
export class CamerasService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CamerasService.name);
  private engine = NativeMediaEngine.getInstance();
  private snapshotCache: Map<
    string,
    { buffer: Buffer; mimeType: string; updatedAt: number }
  > = new Map();

  constructor(
    @Inject(forwardRef(() => TuyaProtectService))
    private readonly tuyaProtect: TuyaProtectService,
    @Inject(forwardRef(() => TuyaMqttService))
    private readonly tuyaMqtt: TuyaMqttService,
    @Inject(TranscoderService) private readonly transcoder: TranscoderService,
  ) {}

  async onModuleInit() {
    this.engine.start();
    this.engine.on("ready", () => {
      this.logger.log(
        "Native Media Engine is ready! Auto-starting registered cameras with contiguous RTSP ports...",
      );
      this.autoStartCameras();
    });

    this.engine.on("session_started", async (did: string, rtspPort: number) => {
      this.logger.log(
        `Session started for camera ${did} on RTSP port ${rtspPort}`,
      );
      const cam = await CameraEntity.findOne({ where: { did } });
      if (cam) {
        cam.online = true;
        cam.rtspPort = rtspPort;
        cam.lastSeen = new Date();
        await cam.save();
        const slug = this.getSlug(cam);
        OfflineCardManager.getInstance().setOnline(slug);

        if (cam.transcodeH264 && cam.h264Port) {
          this.transcoder.startH264Transcode({
            did: cam.did,
            slug,
            sourceRtspPort: cam.rtspPort,
            sourceRtspPath: cam.rtspPath || `live/${slug}`,
            targetRtspPort: cam.h264Port,
          });
        }
      }
    });

    this.engine.on(
      "p2p_connected",
      async (did: string, ip: string, port: number) => {
        this.logger.log(`P2P tunnel connected for ${did} -> ${ip}:${port}`);
        const cam = await CameraEntity.findOne({ where: { did } });
        if (cam) {
          cam.online = true;
          cam.lastSeen = new Date();
          await cam.save();
          const slug = this.getSlug(cam);
          OfflineCardManager.getInstance().setOnline(slug);
        }
      },
    );

    this.engine.on("webrtc_disconnected", async (did: string) => {
      this.logger.warn(`⚠️ [CamerasService] WebRTC disconnected for camera ${did}! Scheduling automatic stream recovery...`);
      const cam = await CameraEntity.findOne({ where: { did } });
      if (cam) {
        cam.online = false;
        await cam.save();
        this.scheduleStreamRecovery(cam, 2000);
      }
    });

    this.engine.on("unhealthy", async (did: string) => {
      this.logger.warn(
        `Camera stream ${did} reported unhealthy! Attempting self-healing recovery...`,
      );
      const cam = await CameraEntity.findOne({ where: { did } });
      if (cam) {
        const slug = this.getSlug(cam);
        OfflineCardManager.getInstance().setOffline({
          slug,
          deviceName: cam.name,
          deviceId: cam.did,
          reason: "Stream Unhealthy · Reconnecting...",
        });
        this.scheduleStreamRecovery(cam, 1000);
      }
    });

    this.startWatchdog();
  }

  private recoveryTimers = new Map<string, NodeJS.Timeout>();
  private watchdogInterval: NodeJS.Timeout | null = null;

  public scheduleStreamRecovery(cam: CameraEntity, delayMs = 2500): void {
    if (this.recoveryTimers.has(cam.did)) {
      clearTimeout(this.recoveryTimers.get(cam.did)!);
    }
    const timer = setTimeout(async () => {
      this.recoveryTimers.delete(cam.did);
      this.logger.log(`🔄 [CamerasService] Auto-reconnecting live stream for ${cam.name} (${cam.did})...`);
      try {
        await this.startStream(cam);
      } catch (err: any) {
        this.logger.error(`Failed to auto-reconnect camera ${cam.did}: ${err.message}`);
        this.scheduleStreamRecovery(cam, Math.min(delayMs * 2, 30000));
      }
    }, delayMs);
    this.recoveryTimers.set(cam.did, timer);
  }

  private startWatchdog(): void {
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);
    this.watchdogInterval = setInterval(async () => {
      try {
        const cameras = await CameraEntity.find();
        for (const cam of cameras) {
          const isStreaming = this.tuyaMqtt.isSessionActive(cam.did);
          if (!isStreaming && !this.recoveryTimers.has(cam.did)) {
            this.logger.debug(`[Watchdog] Camera ${cam.name} stream inactive, auto-reviving...`);
            this.scheduleStreamRecovery(cam, 1000);
          }
        }
      } catch {}
    }, 15000);
  }

  async onModuleDestroy() {
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);
    for (const timer of this.recoveryTimers.values()) clearTimeout(timer);
    this.recoveryTimers.clear();
    this.transcoder.stopAll();
    this.engine.stop();
  }

  public getSlug(cam: {
    name: string;
    did: string;
    rtspPath?: string;
  }): string {
    if (cam.rtspPath && cam.rtspPath.startsWith("live/")) {
      return cam.rtspPath.replace("live/", "");
    }
    return (
      cam.name
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "") || cam.did
    );
  }

  public async autoStartCameras() {
    const cameras = await CameraEntity.find({ order: { createdAt: "ASC" } });
    if (cameras.length === 0) return;

    for (const cam of cameras) {
      cam.rtspPort = env.RTSP_BASE_PORT;
      const cleanSlug = this.getSlug(cam);
      cam.rtspPath = cleanSlug;
      await cam.save();
      await this.startStream(cam);
    }
  }

  async getAll(): Promise<CameraEntity[]> {
    return CameraEntity.find({ order: { createdAt: "DESC" } });
  }

  async getById(id: string): Promise<CameraEntity | null> {
    return CameraEntity.findOne({ where: [{ id }, { did: id }] });
  }

  async refreshTuyaCameras(): Promise<CameraEntity[]> {
    if (!this.tuyaProtect.isLoggedIn()) {
      return CameraEntity.find({ order: { createdAt: "DESC" } });
    }
    const cameras = await this.tuyaProtect.discoverCameras();
    for (const cam of cameras) {
      cam.rtspPort = env.RTSP_BASE_PORT;
      const cleanSlug = this.getSlug(cam);
      cam.rtspPath = cleanSlug;
      await cam.save();
      await this.startStream(cam);
    }
    return cameras;
  }

  async createOrUpdate(dto: CreateCameraDto): Promise<CameraEntity> {
    let cam = await CameraEntity.findOne({ where: { did: dto.did } });
    if (!cam) {
      cam = new CameraEntity();
      cam.id = dto.did;
      cam.did = dto.did;
    }
    cam.name = dto.name;
    cam.localKey = dto.localKey || cam.localKey;
    cam.ip = dto.ip || cam.ip;
    cam.port = dto.port || cam.port;
    cam.p2pId = dto.p2pId || cam.p2pId;
    cam.category = dto.category || cam.category || "sp";
    cam.productId = dto.productId || cam.productId;
    cam.uuid = dto.uuid || cam.uuid;
    cam.quality = dto.quality || "hd";
    cam.audioEnabled = dto.audioEnabled !== undefined ? dto.audioEnabled : true;
    cam.transcodeH264 =
      dto.transcodeH264 !== undefined
        ? dto.transcodeH264
        : cam.transcodeH264 || false;

    if (dto.rtspPort && isPortAllowed(dto.rtspPort)) {
      cam.rtspPort = dto.rtspPort;
    } else if (!cam.rtspPort || !isPortAllowed(cam.rtspPort)) {
      const [freePort] = await findFreePortRange(1, env.RTSP_BASE_PORT);
      cam.rtspPort = freePort;
    }

    if (cam.transcodeH264 && (!cam.h264Port || !isPortAllowed(cam.h264Port))) {
      const [h264Port] = await findFreePortRange(1, cam.rtspPort + 100);
      cam.h264Port = h264Port;
    }

    if (!cam.rtspPath) {
      const safeSlug = this.getSlug(cam);
      cam.rtspPath = `live/${safeSlug}`;
    }

    await cam.save();
    await this.startStream(cam);
    return cam;
  }

  async delete(id: string): Promise<boolean> {
    const cam = await this.getById(id);
    if (!cam) return false;
    const slug = this.getSlug(cam);
    OfflineCardManager.getInstance().setOnline(slug);
    this.transcoder.stopTranscode(cam.did);
    this.engine.stopP2P(cam.did);
    await cam.remove();
    return true;
  }

  async startStream(cam: CameraEntity): Promise<void> {
    const rtspPort = cam.rtspPort || env.RTSP_BASE_PORT;
    const rtspPath = cam.rtspPath || `live/${cam.did}`;

    if (this.tuyaProtect.isLoggedIn()) {
      await this.tuyaMqtt.startCameraSession(
        cam.did,
        rtspPort,
        rtspPath,
        (cam.quality as "hd" | "sd") || "hd",
      );
    } else {
      this.engine.startP2P({
        did: cam.did,
        p2p_id: cam.p2pId || cam.did,
        camera_ip: cam.ip,
        camera_port: cam.port,
        local_key: cam.localKey,
        rtsp_port: rtspPort,
        rtsp_path: rtspPath,
        p2p_quality_channel: cam.quality === "sd" ? 1 : 0,
      });
    }
  }

  stopStream(cam: CameraEntity): void {
    const slug = this.getSlug(cam);
    OfflineCardManager.getInstance().setOffline({
      slug,
      deviceName: cam.name,
      deviceId: cam.did,
      reason: "Stream Stopped",
    });
    this.transcoder.stopTranscode(cam.did);
    this.tuyaMqtt.stopCameraSession(cam.did);
  }

  async ptz(did: string, dto: PtzDto): Promise<boolean> {
    const cloudSuccess = await this.tuyaProtect.movePtz(did, dto.direction);
    if (!cloudSuccess) {
      this.engine.ptz(did, dto.direction);
    }
    return true;
  }

  requestKeyframe(did: string): void {
    this.engine.requestKeyframe(did);
  }

  async getSnapshot(id: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const cam = await this.getById(id);
    const cameraName = cam ? cam.name : "Tuya Camera";
    const did = cam ? cam.did : id;
    const slug = cam ? this.getSlug(cam) : did;

    if (!cam) {
      const offlineBuf = await generateOfflineCardImage({
        slug,
        deviceName: cameraName,
        statusText: "CAMERA NOT FOUND",
        durationSeconds: 1,
      });
      return {
        buffer: offlineBuf || Buffer.from(""),
        mimeType: "image/jpeg",
      };
    }

    const cached = this.snapshotCache.get(cam.did);
    const now = Date.now();
    if (cached && now - cached.updatedAt < 1200) {
      return { buffer: cached.buffer, mimeType: cached.mimeType };
    }

    const dataDir = getDataDir();
    const framesDir = path.join(dataDir, "frames");
    await fsPromises.mkdir(framesDir, { recursive: true });

    const lastLivePath = path.join(framesDir, `${slug}.last_live.jpg`);
    const cleanPath = cam.rtspPath || `live/${slug}`;
    const rtspUrl = `rtsp://127.0.0.1:${cam.rtspPort || env.RTSP_BASE_PORT}/${cleanPath}`;
    const tempFile = path.join("/tmp", `snap_${cam.did}_${Date.now()}.jpg`);

    try {
      await execAsync(
        `ffmpeg -y -rtsp_transport tcp -analyzeduration 1000000 -probesize 1000000 -i "${rtspUrl}" -frames:v 1 -q:v 2 "${tempFile}"`,
        { timeout: 4000 },
      );
      const buf = await fsPromises.readFile(tempFile);
      await fsPromises.unlink(tempFile).catch(() => {});

      await fsPromises.writeFile(lastLivePath, buf).catch(() => {});

      OfflineCardManager.getInstance().setOnline(slug);
      this.snapshotCache.set(cam.did, {
        buffer: buf,
        mimeType: "image/jpeg",
        updatedAt: now,
      });
      return { buffer: buf, mimeType: "image/jpeg" };
    } catch (e: any) {
      this.logger.debug(
        `ffmpeg live snapshot grab fallback for ${cam.did}: ${e.message}`,
      );

      const offlineBuf = await generateOfflineCardImage({
        slug,
        deviceName: cam.name,
        statusText: cam.online ? "BUFFERING STREAM" : "OFFLINE",
        durationSeconds: Math.max(
          1,
          Math.round((Date.now() - (cam.lastSeen?.getTime() || now)) / 1000),
        ),
      });

      if (offlineBuf) {
        this.snapshotCache.set(cam.did, {
          buffer: offlineBuf,
          mimeType: "image/jpeg",
          updatedAt: now,
        });
        return { buffer: offlineBuf, mimeType: "image/jpeg" };
      }

      if (cached) return { buffer: cached.buffer, mimeType: cached.mimeType };
      return { buffer: Buffer.from(""), mimeType: "image/jpeg" };
    }
  }
}
