import EventEmitter from "node:events";
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import axios from "axios";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import QRCode from "qrcode";
import { SettingEntity } from "../db/entities/setting.entity.js";
import { CameraEntity } from "../db/entities/camera.entity.js";
import { cameraRtspPath, cameraSlug } from "../utils/camera-slug.js";
import { OfflineCardManager } from "../cameras/offline-card.js";

export interface TuyaRegion {
  key: string;
  host: string;
  label: string;
}

export const TUYA_REGIONS: Record<string, TuyaRegion> = {
  eu: {
    key: "eu-central",
    host: "protect-eu.ismartlife.me",
    label: "Western Europe (EU)",
  },
  we: {
    key: "eu-east",
    host: "protect-we.ismartlife.me",
    label: "Eastern Europe (WE)",
  },
  us: {
    key: "us-west",
    host: "protect-us.ismartlife.me",
    label: "USA West",
  },
  ue: {
    key: "us-east",
    host: "protect-ue.ismartlife.me",
    label: "USA East",
  },
  cn: {
    key: "china",
    host: "protect.ismartlife.me",
    label: "China",
  },
  in: {
    key: "india",
    host: "protect-in.ismartlife.me",
    label: "India",
  },
};

const CAMERA_CATEGORIES = new Set(["sp", "dghsxj"]);

export interface TuyaLoginResult {
  uid?: string;
  sid?: string;
  ecode?: string;
  username?: string;
  email?: string;
  nickname?: string;
  domain?: {
    mobileMqttsUrl?: string;
    mobileApiUrl?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface StoredSession {
  region: string;
  host: string;
  loginResult: TuyaLoginResult;
  cookies: Array<{ name: string; value: string }>;
  savedAt: string;
}

export interface StoredCredentials {
  email: string;
  password: string;
  countryCode: string;
  region: string;
  savedAt: string;
}

export function formatTuyaError(errorCode?: string, errorMsg?: string): string {
  const code = String(errorCode || "");
  const msg = String(errorMsg || "");
  const combined = `${code} ${msg}`.trim();

  if (combined.includes("USER_PASSWD_WRONG")) {
    return "Incorrect email or password. Please verify your credentials, Country Code (e.g. +1 for Canada/US, +380 for Ukraine), and Server Region.";
  }
  if (combined.includes("USER_PASSWD_ERROR_TIMES_TOO_MANY")) {
    return "Too many failed login attempts. Tuya has temporarily locked password login for 5 minutes. You can log in immediately using the QR Code tab.";
  }
  if (combined.includes("REQUEST_TOO_FREQUENTLY")) {
    return "Request too frequent. Please wait a moment and try again, or use the QR Code tab.";
  }
  if (combined.includes("USER_NOT_EXIST")) {
    return "Account does not exist in the selected country/region. Please verify the Country Code.";
  }
  if (combined.includes("REGION_PROXY_FAILED")) {
    return "Unable to connect to the selected region server. Please try a different region (e.g. USA West / USA East).";
  }
  if (combined.includes("CHECK_VERIFY_ERROR")) {
    return "Tuya security verification triggered. Please log in using the QR Code tab.";
  }
  if (
    combined.includes("USER_SESSION_INVALID") ||
    combined.includes("USER_SESSION_LOSS")
  ) {
    return "Tuya session expired. Please re-authenticate.";
  }

  return msg || code || "Tuya request failed";
}

@Injectable()
export class TuyaProtectService implements OnModuleInit, OnModuleDestroy {
  public readonly events = new EventEmitter();

  isLoggedIn(): boolean {
    return Boolean(
      this.loginResult && (this.loginResult.uid || this.loginResult.token),
    );
  }
  private readonly logger = new Logger(TuyaProtectService.name);
  private regionId = "us";
  private host = TUYA_REGIONS.us.host;
  private currentQrToken: string | null = null;
  private currentQrSvg: string | null = null;
  private currentQrDataUrl: string | null = null;
  private loginResult: TuyaLoginResult | null = null;
  private cookies: Map<string, string> = new Map();
  private lastError: string | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private sessionSaveTimeout: NodeJS.Timeout | null = null;
  private isReauthenticating = false;
  private lastReauthAttempt = 0;
  private hasStoredCredentials = false;

  async onModuleInit() {
    const creds = await this.loadCredentials();
    this.hasStoredCredentials = Boolean(creds);

    const sessionLoaded = await this.loadStoredSession();
    if (sessionLoaded) {
      // Validate active session
      const userInfo = await this.fetchUserInfo().catch(() => null);
      if (!userInfo) {
        this.logger.warn(
          "Stored Tuya session is invalid or expired. Attempting auto-reauth with saved credentials...",
        );
        if (creds) {
          try {
            await this.passwordLogin(
              creds.email,
              creds.password,
              creds.countryCode,
              creds.region,
            );
            this.logger.log(`Auto-logged in on startup as ${creds.email}`);
          } catch (e: any) {
            this.logger.warn(`Startup auto-login failed: ${e.message}`);
          }
        }
      }
    } else {
      if (creds) {
        try {
          await this.passwordLogin(
            creds.email,
            creds.password,
            creds.countryCode,
            creds.region,
          );
          this.logger.log(
            `Auto-logged in on startup with saved credentials as ${creds.email}`,
          );
        } catch (e: any) {
          this.logger.warn(`Startup auto-login failed: ${e.message}`);
        }
      }
    }
    this.startKeepAlive();
  }

  onModuleDestroy() {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    if (this.sessionSaveTimeout) clearTimeout(this.sessionSaveTimeout);
  }

  private startKeepAlive(): void {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    // Ping Tuya API every 20 minutes to prevent web session from expiring due to inactivity
    this.keepAliveInterval = setInterval(
      async () => {
        if (!this.isLoggedIn()) return;
        try {
          await this.postApi("/api/common/user/info", {}, "/playback").catch(
            () => {},
          );
        } catch {}
      },
      20 * 60 * 1000,
    );
    this.keepAliveInterval.unref();
  }

  public getRegionId(): string {
    return this.regionId;
  }

  public getHost(): string {
    return this.host;
  }

  public setRegion(regionId: string): void {
    if (!TUYA_REGIONS[regionId]) {
      throw new Error(`Unknown Tuya region: ${regionId}`);
    }
    this.regionId = regionId;
    this.host = TUYA_REGIONS[regionId].host;
    this.cookies.clear();
    this.currentQrToken = null;
    this.currentQrSvg = null;
    this.currentQrDataUrl = null;
    this.loginResult = null;
  }

  private getCookieHeader(): string {
    const pairs: string[] = [];
    for (const [k, v] of this.cookies.entries()) {
      pairs.push(`${k}=${v}`);
    }
    return pairs.join("; ");
  }

  private updateCookiesFromResponse(headers: Record<string, any>): void {
    const setCookie = headers["set-cookie"];
    if (!setCookie) return;
    const list = Array.isArray(setCookie) ? setCookie : [setCookie];
    let changed = false;
    for (const item of list) {
      const parts = String(item).split(";")[0].split("=");
      if (parts.length >= 2) {
        const name = parts[0].trim();
        const value = parts.slice(1).join("=").trim();
        if (name && this.cookies.get(name) !== value) {
          this.cookies.set(name, value);
          changed = true;
        }
      }
    }
    if (changed && this.loginResult) {
      if (this.sessionSaveTimeout) clearTimeout(this.sessionSaveTimeout);
      this.sessionSaveTimeout = setTimeout(() => {
        void this.saveSession().catch(() => {});
      }, 5000);
      this.sessionSaveTimeout.unref();
    }
  }

  private getHeaders(referer = "/login"): Record<string, string> {
    const origin = `https://${this.host}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=utf-8",
      Accept: "*/*",
      Origin: origin,
      Referer: `${origin}${referer}`,
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };
    const cookieStr = this.getCookieHeader();
    if (cookieStr) {
      headers.Cookie = cookieStr;
    }
    return headers;
  }

  private async postApi<T = any>(
    path: string,
    payload: any = null,
    referer = "/login",
  ): Promise<T> {
    const url = `https://${this.host}${path}`;
    const isAuthEndpoint =
      path.startsWith("/api/login") || path.startsWith("/api/private");

    const res = await axios.post(url, payload !== null ? payload : undefined, {
      headers: this.getHeaders(referer),
      timeout: 20000,
      validateStatus: () => true,
    });

    this.updateCookiesFromResponse(res.headers);

    if (res.status === 401 || res.status === 403) {
      if (!isAuthEndpoint) {
        this.logger.warn(
          `Tuya session is unauthorized (${res.status}). Preserving cameras and triggering re-auth.`,
        );
        void this.handleSessionExpired();
      }
      throw new Error(`Tuya API error (${res.status}): Unauthorized`);
    }

    if (res.status >= 400) {
      throw new Error(`Tuya API error (${res.status}): ${res.statusText}`);
    }

    const data = res.data;
    if (data && typeof data === "object" && data.success === false) {
      const formatted = formatTuyaError(
        data.errorCode,
        data.errorMsg || data.msg,
      );
      if (
        !isAuthEndpoint &&
        (data.errorCode === "USER_SESSION_INVALID" ||
          data.errorCode === "USER_SESSION_LOSS" ||
          String(data.errorMsg || "").includes("USER_SESSION_INVALID"))
      ) {
        this.logger.warn(
          "Tuya session has expired (USER_SESSION_INVALID). Preserving cameras and triggering re-auth.",
        );
        void this.handleSessionExpired();
      }
      const err: any = new Error(formatted);
      err.errorCode = data.errorCode;
      throw err;
    }

    return data;
  }

  public async handleSessionExpired(): Promise<void> {
    const now = Date.now();
    const creds = await this.loadCredentials();

    if (
      creds &&
      !this.isReauthenticating &&
      now - this.lastReauthAttempt > 15000
    ) {
      this.isReauthenticating = true;
      this.lastReauthAttempt = now;
      this.logger.log(
        `Tuya session expired. Attempting background auto-reauthentication for ${creds.email}...`,
      );
      try {
        await this.passwordLogin(
          creds.email,
          creds.password,
          creds.countryCode,
          creds.region,
        );
        this.logger.log(
          `Auto-reauthentication successful for ${creds.email}! Tuya session restored.`,
        );
        this.isReauthenticating = false;
        return;
      } catch (err: any) {
        this.logger.warn(
          `Auto-reauthentication failed: ${err.message}. Preserving cameras in fallback mode.`,
        );
        this.isReauthenticating = false;
      }
    }

    this.loginResult = null;
    this.cookies.clear();
    this.currentQrToken = null;
    this.currentQrSvg = null;
    this.currentQrDataUrl = null;
    this.lastError =
      "Tuya session expired. Please re-authenticate using the Web UI.";
    await SettingEntity.delete({ key: "tuya_session" });
    this.events.emit("session_expired");

    // Mark existing cameras as offline with reason "Session Expired · Please login in Web UI"
    // and keep their database records intact!
    try {
      const cameras = await CameraEntity.find();
      for (const cam of cameras) {
        cam.online = false;
        await cam.save().catch(() => {});
        const slug = cameraSlug(cam.name, cam.did);
        OfflineCardManager.getInstance().setOffline({
          slug,
          deviceName: cam.name,
          deviceId: cam.did,
          reason: "Session Expired · Scan QR in Web UI",
        });
      }
    } catch {}
  }

  public async startQrFlow(
    regionId?: string,
  ): Promise<{ token: string; qrDataUrl: string; qrPayload: string }> {
    if (regionId && regionId !== this.regionId) {
      this.setRegion(regionId);
    }

    try {
      await axios
        .get(`https://${this.host}/login`, {
          headers: this.getHeaders("/login"),
          timeout: 15000,
        })
        .then((r) => this.updateCookiesFromResponse(r.headers))
        .catch(() => {});

      const body = await this.postApi<{ result: string; success: boolean }>(
        "/api/login/security/QCtoken",
        null,
      );
      const token = body.result;
      if (!token) throw new Error("No QR token received from Tuya server");

      this.currentQrToken = token;
      const qrPayload = `tuyaSmart--qrLogin?token=${token}`;
      this.currentQrDataUrl = await QRCode.toDataURL(qrPayload, {
        width: 320,
        margin: 2,
      });
      this.currentQrSvg = await QRCode.toString(qrPayload, {
        type: "svg",
        margin: 2,
      });
      this.lastError = null;

      return {
        token,
        qrDataUrl: this.currentQrDataUrl,
        qrPayload,
      };
    } catch (e: any) {
      this.lastError = e.message;
      this.logger.error(`Failed to start QR flow: ${e.message}`);
      throw e;
    }
  }

  public async pollQr(token?: string): Promise<{
    loggedIn: boolean;
    loginResult?: TuyaLoginResult;
    error?: string;
  }> {
    const targetToken = token || this.currentQrToken;
    if (!targetToken) return { loggedIn: false, error: "No active QR token" };

    try {
      const res = await this.postApi<{ success: boolean; result: any }>(
        "/api/login/poll",
        { token: targetToken },
      );
      let result = res.result;

      if (typeof result === "string") {
        try {
          result = JSON.parse(result);
        } catch {}
      }

      if (
        result &&
        typeof result === "object" &&
        (result.uid || result.sid || result.username || result.email)
      ) {
        this.loginResult = result;
        this.currentQrToken = null;
        await this.saveSession();
        this.logger.log(
          `Successfully authenticated as ${result.email || result.username || result.uid}`,
        );
        this.events.emit("session_authenticated");
        return { loggedIn: true, loginResult: result };
      }

      if (res.success) {
        const userInfo = await this.fetchUserInfo();
        if (userInfo) {
          this.loginResult = userInfo;
          this.currentQrToken = null;
          await this.saveSession();
          this.events.emit("session_authenticated");
          return { loggedIn: true, loginResult: userInfo };
        }
      }

      return { loggedIn: false };
    } catch (e: any) {
      this.lastError = e.message;
      return { loggedIn: false, error: e.message };
    }
  }

  public async passwordLogin(
    email: string,
    password: string,
    countryCode = "1",
    regionId?: string,
  ): Promise<TuyaLoginResult> {
    const cleanEmail = email.trim();
    const cleanCc = String(countryCode).replace(/[^0-9]/g, "") || "1";
    if (!cleanEmail || !password) {
      throw new Error("Email and password required");
    }

    const requestedRegion = regionId || this.regionId || "us";
    const candidateRegions: string[] = [requestedRegion];

    // Smart region fallbacks for North America and Europe
    if (cleanCc === "1") {
      if (!candidateRegions.includes("us")) candidateRegions.push("us");
      if (!candidateRegions.includes("ue")) candidateRegions.push("ue");
    } else if (["49", "33", "44", "380", "39", "34", "31", "48"].includes(cleanCc)) {
      if (!candidateRegions.includes("eu")) candidateRegions.push("eu");
      if (!candidateRegions.includes("we")) candidateRegions.push("we");
    }

    let lastError: any = null;

    for (const reg of candidateRegions) {
      this.setRegion(reg);
      try {
        await axios
          .get(`https://${this.host}/login`, {
            headers: this.getHeaders("/login"),
            timeout: 15000,
          })
          .then((r) => this.updateCookiesFromResponse(r.headers))
          .catch(() => {});

        const tokenRes = await this.postApi<{
          result: { token: string; pbKey: string };
          success: boolean;
        }>("/api/login/token", {
          countryCode: cleanCc,
          username: cleanEmail,
          isUid: false,
        });

        const { token, pbKey } = tokenRes.result || {};
        if (!token) {
          throw new Error(
            "Failed to receive authentication token from Tuya server",
          );
        }

        const md5Pass = crypto.createHash("md5").update(password).digest("hex");

        // Use official Tuya web bundle login format (MD5 hex password with ifencrypt: 0)
        const loginRes = await this.postApi<{
          result: TuyaLoginResult;
          success: boolean;
        }>("/api/private/email/login", {
          countryCode: cleanCc,
          email: cleanEmail,
          passwd: md5Pass,
          token,
          ifencrypt: 0,
          options: '{"group":1}',
        });

        const login = loginRes.result;
        if (!login || (!login.sid && !login.uid && !login.token)) {
          throw new Error("Login succeeded but no user session was returned");
        }

        this.loginResult = login;
        this.lastError = null;
        await this.saveSession();
        await this.saveCredentials({
          email: cleanEmail,
          password,
          countryCode: cleanCc,
          region: this.regionId,
          savedAt: new Date().toISOString(),
        });
        this.logger.log(
          `Logged in successfully with password as ${cleanEmail} (${this.regionId.toUpperCase()})`,
        );
        this.events.emit("session_authenticated");
        return login;
      } catch (e: any) {
        lastError = e;
        if (e.errorCode === "USER_PASSWD_ERROR_TIMES_TOO_MANY_1") {
          break;
        }
        if (
          e.errorCode !== "REGION_PROXY_FAILED" &&
          candidateRegions.length > 1
        ) {
          break;
        }
      }
    }

    const formatted = formatTuyaError(lastError?.errorCode, lastError?.message);
    this.lastError = formatted;
    this.logger.error(`Password login failed: ${formatted}`);
    throw new Error(formatted);
  }

  public async fetchUserInfo(): Promise<TuyaLoginResult | null> {
    const endpoints = ["/api/common/user/info", "/api/customized/web/app/info"];
    for (const ep of endpoints) {
      try {
        const body = await this.postApi<{ result: any }>(
          ep,
          ep.includes("user") ? {} : null,
          "/playback",
        );
        const res = body.result;
        if (
          res &&
          typeof res === "object" &&
          (res.uid || res.sid || res.email || res.username)
        ) {
          return res;
        }
      } catch {}
    }
    return null;
  }

  public async saveCredentials(creds: StoredCredentials): Promise<void> {
    let setting = await SettingEntity.findOne({
      where: { key: "tuya_credentials" },
    });
    if (!setting) {
      setting = new SettingEntity();
      setting.key = "tuya_credentials";
    }
    setting.value = JSON.stringify(creds);
    await setting.save();
    this.hasStoredCredentials = true;
  }

  public async loadCredentials(): Promise<StoredCredentials | null> {
    try {
      const setting = await SettingEntity.findOne({
        where: { key: "tuya_credentials" },
      });
      if (setting && setting.value) {
        this.hasStoredCredentials = true;
        return JSON.parse(setting.value);
      }
    } catch {}
    this.hasStoredCredentials = false;
    return null;
  }

  public async saveSession(): Promise<void> {
    if (!this.loginResult) return;
    const cookiesList: Array<{ name: string; value: string }> = [];
    for (const [name, value] of this.cookies.entries()) {
      cookiesList.push({ name, value });
    }

    const session: StoredSession = {
      region: this.regionId,
      host: this.host,
      loginResult: this.loginResult,
      cookies: cookiesList,
      savedAt: new Date().toISOString(),
    };

    let setting = await SettingEntity.findOne({
      where: { key: "tuya_session" },
    });
    if (!setting) {
      setting = new SettingEntity();
      setting.key = "tuya_session";
    }
    setting.value = JSON.stringify(session);
    await setting.save();
  }

  public async loadStoredSession(): Promise<boolean> {
    try {
      const setting = await SettingEntity.findOne({
        where: { key: "tuya_session" },
      });
      if (setting && setting.value) {
        const session: StoredSession = JSON.parse(setting.value);
        this.regionId = session.region || "us";
        this.host =
          session.host ||
          TUYA_REGIONS[this.regionId]?.host ||
          TUYA_REGIONS.us.host;
        this.loginResult = session.loginResult;
        this.cookies.clear();
        for (const c of session.cookies || []) {
          this.cookies.set(c.name, c.value);
        }

        this.logger.log(
          `Loaded stored session for ${this.loginResult.email || this.loginResult.username || this.loginResult.uid}`,
        );
        return true;
      }

      return false;
    } catch (e: any) {
      this.logger.warn(`Failed to parse stored session: ${e.message}`);
      return false;
    }
  }

  public async logout(): Promise<void> {
    this.loginResult = null;
    this.cookies.clear();
    this.currentQrToken = null;
    this.currentQrSvg = null;
    this.currentQrDataUrl = null;
    this.hasStoredCredentials = false;
    await SettingEntity.delete({ key: "tuya_session" });
    await SettingEntity.delete({ key: "tuya_credentials" });
    this.logger.log(
      "Logged out of Tuya session and cleared stored credentials.",
    );
    this.events.emit("session_expired");
  }

  public getState() {
    return {
      loggedIn: !!this.loginResult,
      hasStoredCredentials: this.hasStoredCredentials,
      region: this.regionId,
      regions: TUYA_REGIONS,
      host: this.host,
      user: this.loginResult
        ? {
            uid: this.loginResult.uid || "",
            email: this.loginResult.email || this.loginResult.username || "",
            nickname: this.loginResult.nickname || "",
          }
        : null,
      hasQr: !!this.currentQrToken,
      qrToken: this.currentQrToken,
      qrDataUrl: this.currentQrDataUrl,
      error: this.lastError,
    };
  }

  public async discoverCameras(): Promise<CameraEntity[]> {
    if (!this.loginResult) {
      throw new Error("Not authenticated to Tuya");
    }

    try {
      await this.postApi(
        "/api/customized/web/app/info",
        null,
        "/playback",
      ).catch(() => {});

      const rawDevices: any[] = [];
      const seenIds = new Set<string>();

      // 1. Fetch Home List
      let homes: any[] = [];
      try {
        const homeRes = await this.postApi<{ result: any[] }>(
          "/api/new/common/homeList",
          null,
          "/playback",
        );
        homes = homeRes.result || [];
      } catch {}

      for (const home of homes) {
        const gid = home.gid || home.id;
        if (!gid) continue;
        try {
          const roomRes = await this.postApi<{ result: any[] }>(
            "/api/new/common/roomList",
            { homeId: String(gid) },
            "/playback",
          );
          for (const room of roomRes.result || []) {
            for (const dev of room.deviceList || []) {
              const did = dev.deviceId || dev.id;
              if (
                dev.category &&
                CAMERA_CATEGORIES.has(dev.category) &&
                did &&
                !seenIds.has(did)
              ) {
                seenIds.add(did);
                rawDevices.push(dev);
              }
            }
          }
        } catch {}
      }

      // 2. Fetch Shared Devices
      try {
        const shareRes = await this.postApi<{ result: any }>(
          "/api/new/playback/shareList",
          null,
          "/playback",
        );
        const list = shareRes.result?.securityWebCShareInfoList || [];
        for (const item of list) {
          for (const dev of item.deviceInfoList || []) {
            const did = dev.deviceId || dev.id;
            if (
              dev.category &&
              CAMERA_CATEGORIES.has(dev.category) &&
              did &&
              !seenIds.has(did)
            ) {
              seenIds.add(did);
              rawDevices.push(dev);
            }
          }
        }
      } catch {}

      // 3. For each camera, fetch config & skills
      const savedCameras: CameraEntity[] = [];
      for (const dev of rawDevices) {
        const did = dev.deviceId || dev.id;
        let skill = "";
        let localKey = "";
        let p2pConfigStr = "";

        try {
          const cfg = await this.postApi<{ result: any }>(
            "/api/jarvis/config",
            {
              devId: did,
              clientTraceId: crypto.randomBytes(8).toString("hex"),
            },
            "/playback",
          );
          const res = cfg.result || {};
          skill = res.skill || "";
          localKey = res.localKey || "";
          p2pConfigStr = JSON.stringify(res.p2pConfig || {});
        } catch {}

        const cleanName = (dev.deviceName || dev.name || did)
          .replace(/[\t\r\n]+/g, " ")
          .trim();
        let cam = await CameraEntity.findOne({ where: { did } });
        if (!cam) {
          cam = new CameraEntity();
          cam.id = did;
          cam.did = did;
        }

        cam.name = cleanName;
        cam.category = dev.category || "sp";
        cam.productId = dev.productId || "";
        cam.uuid = dev.uuid || "";
        cam.skill = skill;
        cam.localKey = localKey || cam.localKey;
        cam.p2pConfig = p2pConfigStr;
        cam.rtspPath = cameraRtspPath(cleanName, did);
        cam.online = true;
        cam.lastSeen = new Date();

        await cam.save();
        savedCameras.push(cam);
      }

      this.logger.log(`Discovered ${savedCameras.length} Tuya camera(s)`);
      return savedCameras;
    } catch (e: any) {
      this.logger.error(`Error discovering cameras: ${e.message}`);
      throw e;
    }
  }

  public async movePtz(
    deviceId: string,
    direction: "up" | "down" | "left" | "right" | "stop",
  ): Promise<boolean> {
    const dirMap: Record<string, string> = {
      up: "0",
      right: "2",
      down: "4",
      left: "6",
    };

    try {
      if (direction === "stop") {
        await this.postApi(
          "/api/jarvis/ptz/control",
          {
            devId: deviceId,
            action: "stop",
          },
          "/playback",
        );
      } else {
        const val = dirMap[direction] || "0";
        await this.postApi(
          "/api/jarvis/ptz/control",
          {
            devId: deviceId,
            action: "start",
            direction: val,
          },
          "/playback",
        );
      }
      return true;
    } catch (e: any) {
      this.logger.warn(`Cloud PTZ failed for ${deviceId}: ${e.message}`);
      return false;
    }
  }

  public async getWebRtcCameraConfig(deviceId: string): Promise<any> {
    try {
      const traceId = `AZ${Date.now()}${crypto.randomBytes(8).toString("hex")}`;
      const cfg = await this.postApi<{ result: any }>(
        "/api/jarvis/config",
        {
          devId: deviceId,
          clientTraceId: traceId,
        },
        "/playback",
      );
      if (cfg.result) {
        cfg.result.clientTraceId = traceId;
      }
      return cfg.result;
    } catch (e: any) {
      this.logger.warn(
        `Failed to get WebRTC config for ${deviceId}: ${e.message}`,
      );
      return null;
    }
  }

  public async getMqttCredentials(): Promise<{
    msid: string;
    password: string;
  } | null> {
    try {
      const res = await this.postApi<{
        result: { msid: string; password: string };
      }>("/api/jarvis/mqtt", {}, "/playback");
      return res.result;
    } catch (e: any) {
      this.logger.warn(`Failed to get MQTT credentials: ${e.message}`);
      return null;
    }
  }
}
