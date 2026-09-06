import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  forwardRef,
} from "@nestjs/common";
import { EventEmitter } from "node:events";
import { TuyaMqttService } from "../auth/tuya-mqtt.service.js";

export type TalkbackHolder = "web" | "rtmp";

export interface TalkbackPublicState {
  did: string;
  holder: TalkbackHolder | null;
  rtmpConnected: boolean;
  webConnected: boolean;
}

export type TalkbackClaimResult =
  | { ok: true; state: TalkbackPublicState }
  | { ok: false; holder: TalkbackHolder; state: TalkbackPublicState };

const SPEAKER_OFF_GRACE_MS = 400;
const WEB_IDLE_MS = 15_000;

interface CameraTalk {
  webOwners: Set<string>;
  rtmpOwners: Set<string>;
  holder: TalkbackHolder | null;
  speakerOn: boolean;
  speakerOffTimer: NodeJS.Timeout | null;
  idleTimer: NodeJS.Timeout | null;
  lastPacketAt: number;
}

/**
 * One speaker owner per camera.
 *
 * Web Talk preempts RTMP/HomeKit: RTMP stays connected and decoded, but
 * packets are dropped until the browser session ends. RTMP/HomeKit blocks
 * new web Talk (frontend disables the button).
 *
 * MQTT 312 speaker is on only while a holder exists, with a short off-grace
 * so web→rtmp handoff does not click the speaker.
 */
@Injectable()
export class TalkbackSessionService
  extends EventEmitter
  implements OnModuleDestroy
{
  private readonly logger = new Logger(TalkbackSessionService.name);
  private readonly cameras = new Map<string, CameraTalk>();

  constructor(
    @Inject(forwardRef(() => TuyaMqttService))
    private readonly tuyaMqtt: TuyaMqttService,
  ) {
    super();
    this.setMaxListeners(20);
  }

  public snapshot(): TalkbackPublicState[] {
    const out: TalkbackPublicState[] = [];
    for (const did of this.cameras.keys()) {
      const state = this.getState(did);
      if (state.holder || state.rtmpConnected || state.webConnected) {
        out.push(state);
      }
    }
    return out;
  }

  public getState(did: string): TalkbackPublicState {
    const cam = this.cameras.get(did);
    if (!cam) {
      return {
        did,
        holder: null,
        rtmpConnected: false,
        webConnected: false,
      };
    }
    return this.toPublic(did, cam);
  }

  public shouldSend(did: string, source: TalkbackHolder): boolean {
    return this.cameras.get(did)?.holder === source;
  }

  public claim(
    did: string,
    source: TalkbackHolder,
    ownerId: string,
  ): TalkbackClaimResult {
    const cam = this.ensure(did);

    if (source === "web") {
      if (cam.rtmpOwners.size > 0) {
        this.logger.log(
          `🎙️ [Talk] web claim denied for ${did}: RTMP/HomeKit is live`,
        );
        return { ok: false, holder: "rtmp", state: this.toPublic(did, cam) };
      }
      if (cam.webOwners.size > 0 && !cam.webOwners.has(ownerId)) {
        this.logger.log(
          `🎙️ [Talk] web claim denied for ${did}: another browser is talking`,
        );
        return { ok: false, holder: "web", state: this.toPublic(did, cam) };
      }
      cam.webOwners.add(ownerId);
    } else {
      cam.rtmpOwners.add(ownerId);
    }

    this.apply(did, cam);
    this.logger.log(
      `🎙️ [Talk] ${source} claimed ${did} owner=${ownerId} holder=${cam.holder} rtmp=${cam.rtmpOwners.size} web=${cam.webOwners.size}`,
    );
    return { ok: true, state: this.toPublic(did, cam) };
  }

  public release(
    did: string,
    source: TalkbackHolder,
    ownerId: string,
  ): TalkbackPublicState {
    const cam = this.cameras.get(did);
    if (!cam) {
      return this.getState(did);
    }
    if (source === "web") {
      cam.webOwners.delete(ownerId);
    } else {
      cam.rtmpOwners.delete(ownerId);
    }
    this.apply(did, cam);
    this.logger.log(
      `🎙️ [Talk] ${source} released ${did} owner=${ownerId} holder=${cam.holder || "none"} rtmp=${cam.rtmpOwners.size} web=${cam.webOwners.size}`,
    );
    this.gc(did, cam);
    return this.getState(did);
  }

  public touch(did: string, source: TalkbackHolder): void {
    const cam = this.cameras.get(did);
    if (!cam || cam.holder !== source) return;
    cam.lastPacketAt = Date.now();
    this.armIdle(did, cam);
  }

  onModuleDestroy(): void {
    for (const [did, cam] of this.cameras) {
      this.clearTimers(cam);
      if (cam.speakerOn) {
        this.tuyaMqtt.sendSpeaker(did, false);
        cam.speakerOn = false;
      }
    }
    this.cameras.clear();
  }

  private ensure(did: string): CameraTalk {
    let cam = this.cameras.get(did);
    if (!cam) {
      cam = {
        webOwners: new Set(),
        rtmpOwners: new Set(),
        holder: null,
        speakerOn: false,
        speakerOffTimer: null,
        idleTimer: null,
        lastPacketAt: 0,
      };
      this.cameras.set(did, cam);
    }
    return cam;
  }

  private apply(did: string, cam: CameraTalk): void {
    const next: TalkbackHolder | null =
      cam.webOwners.size > 0 ? "web" : cam.rtmpOwners.size > 0 ? "rtmp" : null;
    cam.holder = next;
    if (next) {
      this.cancelSpeakerOff(cam);
      this.setSpeaker(did, cam, true);
      cam.lastPacketAt = Date.now();
      this.armIdle(did, cam);
    } else {
      this.clearIdle(cam);
      this.scheduleSpeakerOff(did, cam);
    }
    this.emit("state", this.toPublic(did, cam));
  }

  private setSpeaker(did: string, cam: CameraTalk, on: boolean): void {
    if (cam.speakerOn === on) return;
    cam.speakerOn = on;
    this.tuyaMqtt.sendSpeaker(did, on);
    this.logger.log(`🎙️ [Talk] speaker ${on ? "ON" : "OFF"} ${did}`);
  }

  private scheduleSpeakerOff(did: string, cam: CameraTalk): void {
    this.cancelSpeakerOff(cam);
    if (!cam.speakerOn) return;
    cam.speakerOffTimer = setTimeout(() => {
      cam.speakerOffTimer = null;
      if (cam.holder) return;
      this.setSpeaker(did, cam, false);
      this.gc(did, cam);
    }, SPEAKER_OFF_GRACE_MS);
  }

  private cancelSpeakerOff(cam: CameraTalk): void {
    if (!cam.speakerOffTimer) return;
    clearTimeout(cam.speakerOffTimer);
    cam.speakerOffTimer = null;
  }

  private armIdle(did: string, cam: CameraTalk): void {
    this.clearIdle(cam);
    // RTMP/HomeKit is TCP; unpublish is the release. Only the browser path
    // can ghost (tab killed without talk_stop).
    if (cam.holder !== "web") return;
    cam.idleTimer = setTimeout(() => {
      cam.idleTimer = null;
      if (cam.holder !== "web") return;
      const age = Date.now() - cam.lastPacketAt;
      if (age < WEB_IDLE_MS - 50) {
        this.armIdle(did, cam);
        return;
      }
      this.logger.warn(
        `🎙️ [Talk] web idle timeout on ${did} after ${age}ms — releasing speaker`,
      );
      cam.webOwners.clear();
      this.apply(did, cam);
      this.gc(did, cam);
    }, WEB_IDLE_MS);
  }

  private clearIdle(cam: CameraTalk): void {
    if (!cam.idleTimer) return;
    clearTimeout(cam.idleTimer);
    cam.idleTimer = null;
  }

  private clearTimers(cam: CameraTalk): void {
    this.cancelSpeakerOff(cam);
    this.clearIdle(cam);
  }

  private gc(did: string, cam: CameraTalk): void {
    if (
      cam.holder ||
      cam.speakerOn ||
      cam.speakerOffTimer ||
      cam.webOwners.size ||
      cam.rtmpOwners.size
    ) {
      return;
    }
    this.clearTimers(cam);
    this.cameras.delete(did);
  }

  private toPublic(did: string, cam: CameraTalk): TalkbackPublicState {
    return {
      did,
      holder: cam.holder,
      rtmpConnected: cam.rtmpOwners.size > 0,
      webConnected: cam.webOwners.size > 0,
    };
  }
}
