import { Injectable, Logger, Inject, forwardRef } from "@nestjs/common";
import mqtt, { MqttClient } from "mqtt";
import * as crypto from "node:crypto";
import { TuyaProtectService } from "./tuya-protect.service.js";
import { NativeMediaEngine, type IceServerConfig } from "../engine/native-engine.js";

interface SessionMeta {
  client: MqttClient;
  msid: string;
  userInTopic: string;
  deviceOutTopic: string;
  motoId: string;
  auth: string;
  iceServers: any[];
  sessionId: string;
  isHEVC: boolean;
  streamType: number;
  retryTimer?: NodeJS.Timeout;
  lastOfferSdp?: string;
  answered: boolean;
}

@Injectable()
export class TuyaMqttService {
  private readonly logger = new Logger(TuyaMqttService.name);
  private sessions = new Map<string, SessionMeta>();

  constructor(
    @Inject(forwardRef(() => TuyaProtectService))
    private readonly tuyaProtect: TuyaProtectService,
  ) {
    const engine = NativeMediaEngine.getInstance();
    engine.on("webrtc_offer", (did: string, sdp: string) => {
      this.handleLocalOffer(did, sdp);
    });
    engine.on("webrtc_connected", (did: string) => {
      this.handleWebRTCConnected(did);
    });
    engine.on("ice_candidate", (did: string, candidate: string, mid: string) => {
      this.handleLocalCandidate(did, candidate, mid);
    });
  }

  public async startCameraSession(
    did: string,
    rtspPort: number,
    rtspPath: string,
    quality: "hd" | "sd" = "hd",
  ): Promise<boolean> {
    try {
      this.stopCameraSession(did);

      this.logger.log(`Initiating Tuya WebRTC session for camera ${did}...`);

      // 1. Get MQTT credentials from Tuya
      const creds = await this.tuyaProtect.getMqttCredentials();
      if (!creds || !creds.msid) {
        this.logger.warn(`Failed to obtain MQTT credentials from Tuya`);
        return false;
      }

      const { msid, password } = creds;
      const username = `web_${msid}`;
      const clientId = `web_${msid}`;
      const userInTopic = `/av/u/${msid}`;

      // 2. Get Camera WebRTC & P2P config
      const cfg = await this.tuyaProtect.getWebRtcCameraConfig(did);
      if (!cfg) {
        this.logger.warn(`Failed to obtain WebRTC config for ${did}`);
        return false;
      }

      const motoId = cfg.motoId || cfg.p2pConfig?.motoId || "signaling14752";
      const auth = cfg.auth || cfg.p2pConfig?.auth || "";
      const rawIces = cfg.p2pConfig?.ices || [];
      const deviceOutTopic = `/av/moto/${motoId}/u/${did}`;
      const sessionId = crypto.randomBytes(16).toString("hex");

      let isHEVC = false;
      let streamType = quality === "sd" ? 1 : 0; // In Tuya WebRTC: 0 = HD live, 1 = SD live

      const iceServers: IceServerConfig[] = [];
      for (const item of rawIces) {
        if (item.urls) {
          iceServers.push({
            url: item.urls,
            username: item.username || "",
            password: item.credential || item.password || "",
          });
        }
      }

      if (iceServers.length === 0) {
        iceServers.push({ url: "stun:stun.l.google.com:19302" });
        iceServers.push({ url: "stun:stun1.l.google.com:19302" });
      }

      const mqttUrl = `wss://${username}:${password}@m1.tuyaus.com:443/mqtt`;
      this.logger.log(`Connecting to Tuya MQTT signaling: ${userInTopic} -> ${deviceOutTopic}`);

      const client = mqtt.connect(mqttUrl, {
        username,
        password,
        clientId,
        keepalive: 60,
        clean: true,
        rejectUnauthorized: false,
        connectTimeout: 8000,
      });

      const sessionMeta: SessionMeta = {
        client,
        msid,
        userInTopic,
        deviceOutTopic,
        motoId,
        auth,
        iceServers: rawIces,
        sessionId,
        isHEVC,
        streamType,
        answered: false,
      };

      this.sessions.set(did, sessionMeta);

      client.on("connect", () => {
        this.logger.log(`Connected to Tuya MQTT. Subscribing to: ${userInTopic}`);
        client.subscribe(userInTopic, { qos: 1 }, (err) => {
          if (err) {
            this.logger.error(`MQTT subscription failed for ${did}: ${err.message}`);
          } else {
            this.logger.log(`Subscribed to topic ${userInTopic}. Launching C++ WebRTC session...`);

            // Launch C++ WebRTC peer connection
            NativeMediaEngine.getInstance().startP2P({
              did,
              p2p_id: did,
              rtsp_port: rtspPort,
              rtsp_path: rtspPath,
              p2p_quality_channel: quality === "sd" ? 1 : 0,
              ice_servers: iceServers,
            });
          }
        });
      });

      client.on("message", (topic, payload) => {
        try {
          const str = payload.toString("utf8");
          const msg = JSON.parse(str);
          this.handleMqttMessage(did, msg);
        } catch (e: any) {
          this.logger.warn(`Failed to parse MQTT message on ${topic}: ${e.message}`);
        }
      });

      client.on("error", (err) => {
        this.logger.warn(`MQTT error for camera ${did}: ${err.message}`);
      });

      return true;
    } catch (e: any) {
      this.logger.error(`Error in startCameraSession for ${did}: ${e.message}`);
      return false;
    }
  }

  public stopCameraSession(did: string): void {
    const meta = this.sessions.get(did);
    if (meta) {
      if (meta.retryTimer) {
        clearInterval(meta.retryTimer);
      }
      try {
        const disconnectPayload = {
          protocol: 302,
          pv: "2.2",
          t: Date.now(),
          data: {
            header: {
              type: "disconnect",
              from: meta.msid,
              to: did,
              sub_dev_id: "",
              sessionid: meta.sessionId,
              moto_id: meta.motoId,
              tid: "",
              seq: 0,
              rtx: 0,
            },
            msg: {
              mode: "webrtc",
            },
          },
        };
        meta.client.publish(meta.deviceOutTopic, JSON.stringify(disconnectPayload), { qos: 1 });
      } catch {}
      try {
        meta.client.end(true);
      } catch {}
      this.sessions.delete(did);
    }
    NativeMediaEngine.getInstance().stopP2P(did);
  }

  private handleLocalOffer(did: string, sdp: string): void {
    const meta = this.sessions.get(did);
    if (!meta) return;

    meta.lastOfferSdp = sdp;
    meta.answered = false;

    this.logger.log(`Sending WebRTC SDP Offer to Tuya camera ${did} via ${meta.deviceOutTopic} (isHEVC=${meta.isHEVC}, streamType=${meta.streamType})`);

    const sendOfferPayload = () => {
      if (meta.answered) return;

      const offerPayload = {
        protocol: 302,
        pv: "2.2",
        t: Date.now(),
        data: {
          header: {
            type: "offer",
            from: meta.msid,
            to: did,
            sub_dev_id: "",
            sessionid: meta.sessionId,
            moto_id: meta.motoId,
            tid: "",
            seq: 0,
            rtx: 0,
          },
          msg: {
            mode: "webrtc",
            sdp: meta.lastOfferSdp,
            stream_type: meta.streamType,
            auth: meta.auth,
            token: meta.iceServers,
            replay: {
              is_replay: 0,
            },
            datachannel_enable: meta.isHEVC,
          },
        },
      };

      meta.client.publish(meta.deviceOutTopic, JSON.stringify(offerPayload), { qos: 1 });
    };

    sendOfferPayload();

    if (meta.retryTimer) {
      clearInterval(meta.retryTimer);
    }

    let retries = 0;
    meta.retryTimer = setInterval(() => {
      if (meta.answered || retries >= 4) {
        if (meta.retryTimer) clearInterval(meta.retryTimer);
        return;
      }
      retries++;
      sendOfferPayload();
    }, 2500);
  }

  private handleLocalCandidate(did: string, candidate: string, mid: string): void {
    const meta = this.sessions.get(did);
    if (!meta) return;

    let candStr = candidate;
    if (!candStr.startsWith("a=")) {
      candStr = `a=${candStr}`;
    }

    const candPayload = {
      protocol: 302,
      pv: "2.2",
      t: Date.now(),
      data: {
        header: {
          type: "candidate",
          from: meta.msid,
          to: did,
          sub_dev_id: "",
          sessionid: meta.sessionId,
          moto_id: meta.motoId,
          tid: "",
          seq: 0,
          rtx: 0,
        },
        msg: {
          mode: "webrtc",
          candidate: candStr,
        },
      },
    };

    meta.client.publish(meta.deviceOutTopic, JSON.stringify(candPayload), { qos: 1 });
  }

  private handleMqttMessage(did: string, msg: any): void {
    if (!msg || typeof msg !== "object") return;

    const meta = this.sessions.get(did);
    const header = msg.data?.header || msg.header;
    const dataMsg = msg.data?.msg || msg.msg || msg.data;
    const type = header?.type || msg.type;

    if (type === "answer") {
      if (meta) {
        meta.answered = true;
        if (meta.retryTimer) clearInterval(meta.retryTimer);
      }
      const sdp = dataMsg?.sdp || (typeof dataMsg === "string" ? dataMsg : "");
      if (sdp) {
        this.logger.log(`✅ Received WebRTC SDP Answer from Tuya camera ${did}!`);
        NativeMediaEngine.getInstance().sendLine({
          cmd: "set_remote_answer",
          did,
          sdp,
          type: "answer",
        });
      }
    } else if (type === "candidate") {
      let candidate = dataMsg?.candidate || "";
      if (candidate.startsWith("a=")) {
        candidate = candidate.substring(2);
      }
      if (candidate) {
        NativeMediaEngine.getInstance().sendLine({
          cmd: "add_ice_candidate",
          did,
          candidate,
          mid: dataMsg.mid || "0",
        });
      }
    } else if (type === "disconnect") {
      this.logger.warn(`Camera ${did} sent disconnect: ${JSON.stringify(dataMsg)}`);
      this.stopCameraSession(did);
      NativeMediaEngine.getInstance().emit("webrtc_disconnected", did);
    }
  }

  public isSessionActive(did: string): boolean {
    return this.sessions.has(did);
  }

  private handleWebRTCConnected(did: string): void {
    const meta = this.sessions.get(did);
    if (!meta) return;

    this.logger.log(`🎉 WebRTC peer connection established and streaming for camera ${did}`);
  }
}
