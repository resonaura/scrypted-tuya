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
import * as path from "node:path";
import * as fsPromises from "node:fs/promises";
import type { CreateCameraDto } from "./dto.js";
import { FrameSnapshotter } from "./frame-snapshotter.js";

@Injectable()
export class CamerasService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CamerasService.name);
  private engine = NativeMediaEngine.getInstance();
  private snapshotters = new Map<string, FrameSnapshotter>();
  private activeStreams = new Set<string>();
  private recoveryAttempts = new Map<string, number>();

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
      this.activeStreams.add(did);
      this.recoveryAttempts.delete(did);
      const pendingRecovery = this.recoveryTimers.get(did);
      if (pendingRecovery) clearTimeout(pendingRecovery);
      this.recoveryTimers.delete(did);
      const cam = await CameraEntity.findOne({ where: { did } });
      if (cam) {
        cam.online = true;
        cam.rtspPort = rtspPort;
        cam.lastSeen = new Date();
        await cam.save();
        const slug = this.getSlug(cam);
        OfflineCardManager.getInstance().setOnline(slug);

        this.ensureSnapshotter(cam);

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
      this.activeStreams.delete(did);
      this.logger.warn(`⚠️ [CamerasService] WebRTC disconnected for camera ${did}! Scheduling automatic stream recovery...`);
      const cam = await CameraEntity.findOne({ where: { did } });
      if (cam) {
        cam.online = false;
        await cam.save();
        this.scheduleStreamRecovery(cam, 2000);
      }
    });

    this.engine.on("unhealthy", async (did: string) => {
      this.activeStreams.delete(did);
      this.logger.warn(
        `Camera stream ${did} reported unhealthy! Attempting self-healing recovery...`,
      );
      const cam = await CameraEntity.findOne({ where: { did } });
      if (cam) {
        this.stopSnapshotter(cam.did);
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

  public scheduleStreamRecovery(cam: CameraEntity, delayMs = 250): void {
    if (this.recoveryTimers.has(cam.did)) return;
    const attempt = (this.recoveryAttempts.get(cam.did) || 0) + 1;
    this.recoveryAttempts.set(cam.did, attempt);
    const backoff = attempt === 1 ? delayMs : Math.min(1000 * 2 ** Math.min(attempt - 2, 5), 30_000);
    const jitteredDelay = Math.round(backoff * (0.8 + Math.random() * 0.2));
    OfflineCardManager.getInstance().updateStatus(
      this.getSlug(cam),
      `Reconnecting P2P stream · attempt ${attempt}`,
    );
    const timer = setTimeout(async () => {
      this.recoveryTimers.delete(cam.did);
      this.logger.warn(`Reconnecting ${cam.name} (${cam.did}), attempt ${attempt}`);
      try {
        this.stopSnapshotter(cam.did);
        this.tuyaMqtt.stopCameraSession(cam.did);
        await this.startStream(cam);
      } catch (err: any) {
        this.logger.warn(`Reconnect attempt ${attempt} failed for ${cam.did}: ${err.message}`);
        this.scheduleStreamRecovery(cam);
      }
    }, jitteredDelay);
    timer.unref();
    this.recoveryTimers.set(cam.did, timer);
  }

  private startWatchdog(): void {
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);
    this.watchdogInterval = setInterval(async () => {
      try {
        const cameras = await CameraEntity.find();
        for (const cam of cameras) {
          const isStreaming = this.activeStreams.has(cam.did) || this.tuyaMqtt.isSessionActive(cam.did);
          if (!isStreaming && !this.recoveryTimers.has(cam.did)) {
            this.logger.debug(`[Watchdog] Camera ${cam.name} stream inactive, auto-reviving...`);
            this.scheduleStreamRecovery(cam, 1000);
          }
        }
      } catch {}
    }, 15000);
    this.watchdogInterval.unref();
  }

  async onModuleDestroy() {
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);
    for (const timer of this.recoveryTimers.values()) clearTimeout(timer);
    this.recoveryTimers.clear();
    this.activeStreams.clear();
    this.recoveryAttempts.clear();
    for (const did of [...this.snapshotters.keys()]) this.stopSnapshotter(did);
    OfflineCardManager.getInstance().stopAll();
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
    if (!cam.transcodeH264) this.transcoder.stopTranscode(cam.did);
    await this.startStream(cam);
    return cam;
  }

  async delete(id: string): Promise<boolean> {
    const cam = await this.getById(id);
    if (!cam) return false;
    const slug = this.getSlug(cam);
    OfflineCardManager.getInstance().setOnline(slug);
    this.activeStreams.delete(cam.did);
    this.stopSnapshotter(cam.did);
    this.transcoder.stopTranscode(cam.did);
    this.engine.stopP2P(cam.did);
    await cam.remove();
    return true;
  }

  async startStream(cam: CameraEntity): Promise<void> {
    const rtspPort = cam.rtspPort || env.RTSP_BASE_PORT;
    const rtspPath = cam.rtspPath || `live/${cam.did}`;

    if (this.tuyaProtect.isLoggedIn()) {
      const started = await this.tuyaMqtt.startCameraSession(
        cam.did,
        rtspPort,
        rtspPath,
        (cam.quality as "hd" | "sd") || "hd",
      );
      if (!started) throw new Error("Tuya signaling session did not start");
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
    this.activeStreams.delete(cam.did);
    this.stopSnapshotter(cam.did);
    this.transcoder.stopTranscode(cam.did);
    this.tuyaMqtt.stopCameraSession(cam.did);
  }

  requestKeyframe(did: string): void {
    this.engine.requestKeyframe(did);
  }

  private ensureSnapshotter(cam: CameraEntity): void {
    if (this.snapshotters.has(cam.did)) return;
    const slug = this.getSlug(cam);
    const rtspUrl = `rtsp://127.0.0.1:${cam.rtspPort || env.RTSP_BASE_PORT}/${cam.rtspPath || `live/${slug}`}`;
    const snapshotter = new FrameSnapshotter({
      slug,
      did: cam.did,
      rtspUrl,
      dataDir: getDataDir(),
      intervalMs: 10_000,
      maxConsecutiveFailures: 3,
    });
    snapshotter.on("frame", ({ buffer }: { buffer: Buffer }) => {
      OfflineCardManager.getInstance().setOnline(slug);
      cam.online = true;
      cam.lastSeen = new Date();
      void cam.save().catch(() => {});
      if (buffer.length > 0) this.logger.debug(`Snapshot refreshed for ${cam.name}`);
    });
    snapshotter.on("failure", ({ count, max }: { count: number; max: number }) => {
      OfflineCardManager.getInstance().setOffline({
        slug,
        deviceName: cam.name,
        deviceId: cam.did,
        reason: `Snapshot unavailable · retry ${count}/${max}`,
      });
    });
    snapshotter.on("unhealthy", () => {
      if (this.snapshotters.get(cam.did) !== snapshotter) return;
      this.stopSnapshotter(cam.did);
      OfflineCardManager.getInstance().setOffline({
        slug,
        deviceName: cam.name,
        deviceId: cam.did,
        reason: "Snapshot unavailable · Reconnecting stream",
      });
      this.scheduleStreamRecovery(cam, 250);
    });
    this.snapshotters.set(cam.did, snapshotter);
    snapshotter.start();
  }

  private stopSnapshotter(did: string): void {
    const snapshotter = this.snapshotters.get(did);
    if (!snapshotter) return;
    this.snapshotters.delete(did);
    snapshotter.removeAllListeners();
    snapshotter.stop();
  }

  async getSnapshot(id: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const cam = await this.getById(id);
    const did = cam?.did || id;
    const slug = cam ? this.getSlug(cam) : did;
    const framePath = path.join(getDataDir(), "frames", `${slug}.jpg`);

    try {
      const buffer = await fsPromises.readFile(framePath);
      if (buffer.length > 0) return { buffer, mimeType: "image/jpeg" };
    } catch {}

    const buffer = await generateOfflineCardImage({
      slug,
      deviceName: cam?.name || "Tuya Camera",
      statusText: cam ? (cam.online ? "WAITING FOR VIDEO" : "OFFLINE") : "CAMERA NOT FOUND",
      durationSeconds: 1,
    });
    return { buffer: buffer || Buffer.from(""), mimeType: "image/jpeg" };
  }
}
