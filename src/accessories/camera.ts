import sdk, {
  ScryptedDeviceBase,
  VideoCamera,
  MotionSensor,
  BinarySensor,
  MediaObject,
  MediaStreamOptions,
  MediaStreamUrl,
  ScryptedMimeTypes,
  ResponseMediaStreamOptions,
  OnOff,
  DeviceProvider,
  Online,
  Logger,
  Intercom,
  ScryptedNativeId,
  Device,
  ScryptedDeviceType,
  ScryptedInterface,
  Setting,
  Settings,
  SettingValue,
} from "@scrypted/sdk";
import { spawn, type ChildProcess } from "child_process";
import type { Readable } from "stream";
import { TuyaAccessory } from "./accessory";
import { TuyaPlugin } from "../plugin";
import { TuyaDevice, TuyaDeviceStatus } from "../tuya/const";
import { selectMaximumQuality } from "../tuya/quality";
import { StorageSettings } from "@scrypted/sdk/storage-settings";

// TODO: Allow setting motion info based on dp name?
const SCHEMA_CODE = {
  MOTION_ON: ['motion_switch', 'pir_sensitivity', 'motion_sensitivity'],
  MOTION_DETECT: ['movement_detect_pic'],
  // Indicates that this is possibly a doorbell
  DOORBELL: ['doorbell_ring_exist'],
  // Notifies when a doorbell ring occurs.
  DOORBELL_RING: ['doorbell_pic'],
  // Notifies when a doorbell ring or motion occurs.
  ALARM_MESSAGE: ['alarm_message'],
  LIGHT_ON: ['floodlight_switch'],
  LIGHT_BRIGHT: ['floodlight_lightness'],
  INDICATOR: ["basic_indicator"]
};

export class TuyaCamera extends TuyaAccessory implements DeviceProvider, VideoCamera, BinarySensor, MotionSensor, OnOff, Settings, Intercom {
  private lightAccessory: ScryptedDeviceBase | undefined;
  private selectedQuality: string | undefined;
  private intercomProcess: ChildProcess | null = null;
  private storageSettings = new StorageSettings(this, {
    p2pRtspUrl: {
      title: "Smart Life P2P HD RTSP URL",
      description: "Optional HD URL from Tuya RTSP Bridge, for example rtsp://home-assistant:8600/CameraName/hd. When configured, this replaces Tuya Cloud RTSP video while keeping Tuya events and controls.",
      type: "string",
      placeholder: "rtsp://home-assistant:8600/CameraName/hd",
    },
    talkbackRtmpUrl: {
      title: "Talkback RTMP URL",
      description: "Optional RTMP ingest URL for talkback audio (e.g. rtmp://home-assistant:1935/talk/CameraName). If blank, automatically resolves from the Smart Life P2P bridge RTSP URL.",
      type: "string",
      placeholder: "rtmp://home-assistant:1935/talk/CameraName",
    },
  });

  constructor(state: TuyaDevice, controller: TuyaPlugin) {
    super(state, controller);
    if (this.storageSettings.values.p2pRtspUrl?.trim()) {
      this.online = true;
    }
  }

  async getSettings(): Promise<Setting[]> {
    return this.storageSettings.getSettings();
  }

  async putSetting(key: string, value: SettingValue): Promise<void> {
    await this.storageSettings.putSetting(key, value);
    if (key === "p2pRtspUrl") {
      if (this.storageSettings.values.p2pRtspUrl?.trim()) {
        this.online = true;
      }
      this.onDeviceEvent(ScryptedInterface.VideoCamera, undefined);
    }
  }

  async updateAllValues(): Promise<void> {
    if (this.storageSettings.values.p2pRtspUrl?.trim()) {
      this.online = true;
      await this.updateStatus(this.tuyaDevice.status || []);
    } else {
      await super.updateAllValues();
    }
  }

  get deviceSpecs(): Device {
    const indicatorSchema = !!this.getSchema(...SCHEMA_CODE.INDICATOR);
    const motionSchema = !!this.getSchema(...SCHEMA_CODE.MOTION_ON);
    const doorbellSchema = !!this.getSchema(...SCHEMA_CODE.DOORBELL) && !!this.getSchema(...SCHEMA_CODE.ALARM_MESSAGE, ...SCHEMA_CODE.DOORBELL_RING);

    return {
      ...super.deviceSpecs,
      type: doorbellSchema ? ScryptedDeviceType.Doorbell : ScryptedDeviceType.Camera,
      interfaces: [
        ...super.deviceSpecs.interfaces,
        ScryptedInterface.VideoCamera,
        ScryptedInterface.DeviceProvider,
        ScryptedInterface.Settings,
        ScryptedInterface.Intercom,
        indicatorSchema ? ScryptedInterface.OnOff : null,
        motionSchema ? ScryptedInterface.MotionSensor : null,
        doorbellSchema ? ScryptedInterface.BinarySensor : null,
      ]
      .filter((p): p is ScryptedInterface => !!p)
    }
  }

  async startIntercom(media: MediaObject): Promise<void> {
    await this.stopIntercom();

    const targetUrl = this.resolveTalkbackRtmpUrl();
    if (!targetUrl) {
      this.console.warn(`[${this.name}] Cannot start talkback: no Talkback RTMP URL configured and could not auto-derive from bridge.`);
      throw new Error(`Talkback RTMP URL not configured for ${this.name}`);
    }

    this.console.info(`[${this.name}] Starting talkback session -> ${targetUrl}`);

    try {
      const inputStream = await sdk.mediaManager.convertMediaObject<Readable>(
        media,
        "audio/x-wav"
      );

      const ffmpegArgs = [
        "-hide_banner",
        "-loglevel", "error",
        "-fflags", "nobuffer",
        "-flags", "low_delay",
        "-probesize", "32",
        "-analyzeduration", "0",
        "-i", "pipe:0",
        "-vn",
        "-c:a", "aac",
        "-b:a", "16k",
        "-ar", "16000",
        "-ac", "1",
        "-f", "flv",
        targetUrl,
      ];

      this.intercomProcess = spawn("ffmpeg", ffmpegArgs, {
        stdio: ["pipe", "ignore", "pipe"],
      });

      this.intercomProcess.stderr?.on("data", (chunk: Buffer) => {
        const msg = chunk.toString().trim();
        if (msg) this.console.debug(`[${this.name}] [Talkback FFmpeg] ${msg}`);
      });

      this.intercomProcess.on("error", (err: Error) => {
        this.console.error(`[${this.name}] Talkback FFmpeg process error:`, err);
      });

      this.intercomProcess.on("close", (code: number | null) => {
        this.console.info(`[${this.name}] Talkback session ended (code ${code})`);
        this.intercomProcess = null;
      });

      inputStream.pipe(this.intercomProcess.stdin!);
    } catch (e: any) {
      this.console.error(`[${this.name}] Failed to start talkback:`, e);
      await this.stopIntercom();
      throw e;
    }
  }

  async stopIntercom(): Promise<void> {
    if (this.intercomProcess) {
      try {
        this.intercomProcess.stdin?.destroy();
        this.intercomProcess.kill("SIGKILL");
      } catch {}
      this.intercomProcess = null;
    }
  }

  private resolveTalkbackRtmpUrl(): string | null {
    const configured = this.storageSettings.values.talkbackRtmpUrl?.trim();
    if (configured) return configured;

    const cameraName = this.name || this.tuyaDevice.name || this.tuyaDevice.id;
    const rtsp = this.storageSettings.values.p2pRtspUrl?.trim();
    if (rtsp) {
      try {
        const u = new URL(rtsp);
        const pathParts = u.pathname.split("/").filter(Boolean);
        const lastPart = pathParts.length > 0 ? pathParts[pathParts.length - 1] : undefined;
        const slug = lastPart || cameraName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        return `rtmp://${u.hostname}:1935/talk/${slug}`;
      } catch {}
    }

    const slug = cameraName
      .toLowerCase()
      .replace(/\bcamera\b/g, " ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || this.tuyaDevice.id;
    return `rtmp://127.0.0.1:1935/talk/${slug}`;
  }

  async getDevice(nativeId: ScryptedNativeId) {
    if (nativeId === this.nativeId + "-light") {
      return this.lightAccessory;
    } else {
      throw new Error("Light not found")
    }
  }

  async releaseDevice(id: string, nativeId: ScryptedNativeId): Promise<void> { }

  // OnOff Status Indicator
  async turnOff(): Promise<void> {
    const indicatorSchema = this.getSchema(...SCHEMA_CODE.INDICATOR);
    if (!indicatorSchema || indicatorSchema.mode == "r") return;
    await this.sendCommands({ code: indicatorSchema.code, value: false })
  }

  async turnOn(): Promise<void> {
    const indicatorSchema = this.getSchema(...SCHEMA_CODE.INDICATOR);
    if (!indicatorSchema || indicatorSchema.mode == "r") return;
    await this.sendCommands({ code: indicatorSchema.code, value: true })
  }

  // Video Camera
  async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
    const p2pRtspUrl = this.storageSettings.values.p2pRtspUrl?.trim();
    let streamUrl: string;

    if (p2pRtspUrl) {
      if (!/^rtsps?:\/\//i.test(p2pRtspUrl)) {
        throw new Error(`Invalid Smart Life P2P RTSP URL for ${this.name}. The URL must start with rtsp:// or rtsps://.`);
      }
      streamUrl = p2pRtspUrl;
      this.console.info(`[${this.name}] Using Smart Life P2P main/HD stream through the configured RTSP bridge: ${streamUrl}`);
    } else {
      if (!this.tuyaDevice.online) {
        this.log.e(`${this.name} is currently offline. Will not be able to stream until device is back online.`);
        throw new Error(`Failed to stream ${this.name}: Camera is offline.`);
      }

      await this.requestMaximumQuality();
      // Give the camera time to apply the quality change before allocating RTSP.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const rtsps = await this.plugin.api?.getRTSP(this.tuyaDevice.id);

      if (!rtsps) {
        this.log.e("There was an error retrieving the camera live feed.");
        throw new Error(`Failed to capture stream for ${this.name}: RTSP link not found.`);
      }
      streamUrl = rtsps.url;
      this.console.info(`[${this.name}] Cloud RTSP stream URL: ${streamUrl}`);
      this.console.info(`[${this.name}] Probe resolution with: ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 ${streamUrl}`);
    }

    const streamOptions = (await this.getVideoStreamOptions())[0];
    return this.createMediaObject(
      {
        url: streamUrl,
        container: "rtsp",
        mediaStreamOptions: streamOptions,
      } satisfies MediaStreamUrl,
      ScryptedMimeTypes.MediaStreamUrl
    );
  }

  private async requestMaximumQuality(): Promise<void> {
    const selection = selectMaximumQuality(this.tuyaDevice);
    if (!selection) {
      this.console.debug(`[${this.name}] Tuya does not expose a writable, recognised video-quality capability. Using the RTSP quality selected by Tuya.`);
      return;
    }

    if (selection.current?.value === selection.value) {
      this.console.debug(`[${this.name}] Tuya quality already at maximum: ${selection.code}=${selection.value}`);
      return;
    }

    if (this.selectedQuality === selection.value) {
      this.console.debug(`[${this.name}] Quality already selected this session: ${selection.code}=${selection.value}`);
      return;
    }

    this.console.info(`[${this.name}] Requesting maximum advertised Tuya video quality: ${selection.code}=${selection.value}`);

    try {
      const commands = [{
        code: selection.code,
        value: selection.value,
      }];
      this.console.debug(`[${this.name}] Sending command: ${JSON.stringify(commands)}`);
      const changed = await this.plugin.api?.sendCommands(this.tuyaDevice.id, commands);

      if (changed) {
        this.selectedQuality = selection.value;
        if (selection.current) {
          selection.current.value = selection.value;
        } else {
          this.tuyaDevice.status.push({ code: selection.code, value: selection.value });
        }
        this.console.info(`[${this.name}] Maximum quality command accepted: ${selection.code}=${selection.value}`);
      } else {
        this.console.warn(`[${this.name}] Tuya rejected the maximum-quality command (${selection.code}=${selection.value}). Falling back to Tuya's default RTSP quality.`);
      }
    } catch (e) {
      this.console.warn(`[${this.name}] Could not select maximum Tuya video quality. Falling back to Tuya's default RTSP quality.`, e);
    }
  }

  private qualityToResolution(qualityValue: string): { width?: number; height?: number } | undefined {
    const v = qualityValue.toLowerCase().trim();
    const map: Record<string, { width: number; height: number }> = {
      "ssuper": { width: 3840, height: 2160 },
      "super_ultra": { width: 3840, height: 2160 },
      "super-ultra": { width: 3840, height: 2160 },
      "superuhd": { width: 3840, height: 2160 },
      "super_uhd": { width: 3840, height: 2160 },
      "ultra": { width: 3840, height: 2160 },
      "uhd": { width: 3840, height: 2160 },
      "4k": { width: 3840, height: 2160 },
      "2k": { width: 2560, height: 1440 },
      "super": { width: 2560, height: 1440 },
      "hd": { width: 1920, height: 1080 },
      "1080p": { width: 1920, height: 1080 },
      "high": { width: 1280, height: 720 },
      "720p": { width: 1280, height: 720 },
      "standard": { width: 640, height: 360 },
      "sd": { width: 640, height: 360 },
      "medium": { width: 640, height: 360 },
      "normal": { width: 640, height: 360 },
      "low": { width: 320, height: 180 },
      "fluent": { width: 320, height: 180 },
      "smooth": { width: 320, height: 180 },
    };
    return map[v];
  }

  async getVideoStreamOptions(): Promise<[ResponseMediaStreamOptions]> {
    const p2pRtspUrl = this.storageSettings.values.p2pRtspUrl?.trim();
    const selection = selectMaximumQuality(this.tuyaDevice);
    const resolution = selection ? this.qualityToResolution(selection.value) : undefined;
    return [
      {
        id: "cloud-rtsp",
        name: p2pRtspUrl ? "Smart Life P2P HD" : "Cloud RTSP",
        container: "rtsp",
        tool: "ffmpeg",
        source: p2pRtspUrl ? "local" : "cloud",
        oobCodecParameters: false,
        prebuffer: 4000,
        video: {
          codec: p2pRtspUrl ? "hevc" : "h264",
          ...(resolution ? { width: resolution.width, height: resolution.height } : {}),
        },
        audio: {
          codec: "pcm_alaw",
        },
      },
    ];
  }

  async updateStatus(status: TuyaDeviceStatus[]): Promise<void> {
    super.updateStatus(status);

    const indicatorSchema = this.getSchema(...SCHEMA_CODE.INDICATOR);
    if (indicatorSchema) {
      const indicatorStatus = status.find(s=> s.code === indicatorSchema.code);
      indicatorStatus && (this.on = indicatorStatus.value === true)
    }

    const motionSchema = this.getSchema(...SCHEMA_CODE.MOTION_DETECT);
    if (this.getSchema(...SCHEMA_CODE.MOTION_ON) && motionSchema) {
      const motionStatus = status.find(s=> s.code === motionSchema.code);
      motionStatus && motionStatus.value.toString().length > 1 && this.debounce(
        motionSchema,
        10 * 1000,
        () => this.motionDetected = true, 
        () => this.motionDetected = false,
      )
    }

    const doorbellNotifSchema = this.getSchema(...SCHEMA_CODE.ALARM_MESSAGE, ...SCHEMA_CODE.DOORBELL_RING);
    if (this.getSchema(...SCHEMA_CODE.DOORBELL) && doorbellNotifSchema) {
      const doorbellStatus = status.find(s => [...SCHEMA_CODE.ALARM_MESSAGE, ...SCHEMA_CODE.DOORBELL_RING].includes(s.code));
      doorbellStatus && doorbellStatus.value.toString().length > 1 && this.debounce(
        doorbellNotifSchema,
        10 * 1000,
        () => this.binaryState = true, 
        () => this.binaryState = false
      );
    }

    const lightSchema = this.getSchema(...SCHEMA_CODE.LIGHT_ON);
    if (lightSchema) {
      const plugin = this.plugin;
      const deviceId = this.tuyaDevice.id;

      if (!this.lightAccessory) {
        this.lightAccessory = Object.assign(
          new ScryptedDeviceBase(this.tuyaDevice.id + "-light"),
          {
            turnOff: async function () {
              await plugin.api?.sendCommands(deviceId, [{ code: lightSchema.code, value: false }])
            },
            turnOn: async function () {
              await plugin.api?.sendCommands(deviceId, [{ code: lightSchema.code, value: true }])
            },
          } satisfies OnOff & Online
        );

        await sdk.deviceManager.onDeviceDiscovered(
          {
            providerNativeId: this.tuyaDevice.id,
            name: this.tuyaDevice.name + " Light",
            nativeId: this.lightAccessory.nativeId,
            info: this.deviceSpecs.info,
            type: ScryptedDeviceType.Light,
            interfaces: [
              ScryptedInterface.OnOff,
              ScryptedInterface.Online
            ]
          }
        )
      }

      const lightStatus = status.find(s=> s.code === lightSchema.code);
      lightStatus && (this.lightAccessory.on = !!lightStatus.value);
    }
  }
}