import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import axios, { type Method } from "axios";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomInt,
  randomUUID,
} from "node:crypto";
import { SettingEntity } from "../db/entities/setting.entity.js";

export interface TuyaSharingTokenInfo {
  userCode: string;
  uid: string;
  accessToken: string;
  refreshToken: string;
  expires: number;
  terminalId: string;
  username: string;
  endpoint: string;
}

export interface TuyaResponse<T> {
  result: T;
  success: boolean;
  t?: number;
  tid?: string;
  msg?: string;
  errorMsg?: string;
  errorCode?: string;
}

function _formToJson(content: Record<string, any>) {
  return JSON.stringify(content, null, 0);
}

function _secretGenerating(rid: string, sid: string, hashKey: string) {
  let message = hashKey;
  const mod = 16;

  if (sid !== "") {
    const sidLength = sid.length;
    const length = sidLength < mod ? sidLength : mod;
    let ecode = "";
    for (let i = 0; i < length; i++) {
      const idx = sid.charCodeAt(i) % mod;
      ecode += sid[idx];
    }
    message += "_";
    message += ecode;
  }

  const checksum = createHmac("sha256", rid).update(message, "utf-8").digest();
  const secret = checksum.toString("hex");
  return secret.substring(0, 16);
}

function _randomNonce(e = 32) {
  const t = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";
  const a = t.length;
  let n = "";
  for (let i = 0; i < e; i++) {
    n += t[randomInt(0, a)];
  }
  return Buffer.from(n, "utf-8");
}

function _aesGcmEncrypt(rawData: string, secret: string) {
  const nonce = _randomNonce(12);
  const cipher = createCipheriv("aes-128-gcm", Buffer.from(secret, "utf-8"), nonce);
  const encrypted = Buffer.concat([cipher.update(rawData, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([nonce, encrypted, authTag]).toString("base64");
}

function _aesGcmDecrypt(cipherData: string, secret: string) {
  const cipherBuffer = Buffer.from(cipherData, "base64");
  const nonce = cipherBuffer.subarray(0, 12);
  const cipherText = cipherBuffer.subarray(12);
  const decipher = createDecipheriv("aes-128-gcm", Buffer.from(secret, "utf-8"), nonce);
  decipher.setAuthTag(cipherText.subarray(-16));
  const encryptedData = cipherText.subarray(0, -16);
  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  return decrypted.toString("utf8");
}

function _restfulSign(
  hashKey: string,
  queryEncData: string,
  bodyEncData: string,
  data: Map<string, string>,
) {
  const headers = ["X-appKey", "X-requestId", "X-sid", "X-time", "X-token"];
  const headerSign: string[] = [];

  for (const item of headers) {
    const val = data.get(item) || "";
    if (val) headerSign.push(`${item}=${val}`);
  }

  let signStr = headerSign.join("||");
  if (queryEncData) signStr += queryEncData;
  if (bodyEncData) signStr += bodyEncData;

  return createHmac("sha256", hashKey).update(signStr, "utf-8").digest("hex");
}

@Injectable()
export class TuyaSharingService implements OnModuleInit {
  private static readonly clientId = "HA_3y9q4ak7g4ephrvke";
  private readonly logger = new Logger(TuyaSharingService.name);

  private tokenInfo: TuyaSharingTokenInfo | null = null;
  private updatingTokenPromise: Promise<void> | null = null;
  private cloudRtspCache = new Map<string, { url: string; expires: number }>();

  async onModuleInit() {
    await this.loadStoredToken();
  }

  public isConfigured(): boolean {
    return !!this.tokenInfo?.accessToken;
  }

  public async logout(): Promise<void> {
    this.tokenInfo = null;
    this.cloudRtspCache.clear();
    await SettingEntity.delete({ key: "tuya_sharing_token" });
    this.logger.log("Logged out of Tuya Sharing API session.");
  }

  public async loadStoredToken(): Promise<boolean> {
    try {
      const setting = await SettingEntity.findOne({ where: { key: "tuya_sharing_token" } });
      if (setting?.value) {
        this.tokenInfo = JSON.parse(setting.value);
        this.logger.log(`Loaded stored Tuya Sharing token for user: ${this.tokenInfo?.username || "unknown"}`);
        return true;
      }
    } catch (e: any) {
      this.logger.warn(`Failed to load stored Tuya Sharing token: ${e.message}`);
    }
    return false;
  }

  public async saveToken(token: TuyaSharingTokenInfo): Promise<void> {
    this.tokenInfo = token;
    let setting = await SettingEntity.findOne({ where: { key: "tuya_sharing_token" } });
    if (!setting) {
      setting = new SettingEntity();
      setting.key = "tuya_sharing_token";
    }
    setting.value = JSON.stringify(token);
    await setting.save();
    this.logger.log(`Saved Tuya Sharing token for user: ${token.username}`);
  }

  public async getRTSP(deviceId: string): Promise<string | null> {
    const cached = this.cloudRtspCache.get(deviceId);
    if (cached && cached.expires > Date.now() + 10_000) {
      return cached.url;
    }

    if (!this.tokenInfo) {
      return null;
    }

    try {
      const response = await this._request<{ url: string }>(
        "POST",
        `/v1.0/m/ipc/${deviceId}/stream/actions/allocate`,
        undefined,
        { type: "rtsp" },
      );

      if (response.success && response.result?.url) {
        const url = response.result.url;
        const expires = (response.t ?? Date.now()) + 30_000;
        this.cloudRtspCache.set(deviceId, { url, expires });
        this.logger.log(`[Cloud RTSP] Allocated clean cloud stream for ${deviceId}: ${url}`);
        return url;
      }
    } catch (e: any) {
      this.logger.warn(`[Cloud RTSP] Failed to allocate Cloud RTSP for ${deviceId}: ${e.message}`);
    }
    return null;
  }

  private async _request<T = any>(
    method: Method,
    path: string,
    params?: Record<string, any>,
    body?: Record<string, any>,
    skipRefreshToken?: boolean,
  ): Promise<TuyaResponse<T>> {
    if (!this.tokenInfo) {
      throw new Error("Tuya Sharing API is not authenticated");
    }

    if (!skipRefreshToken) {
      await this.refreshTokenIfNeeded();
    }

    const rid = randomUUID();
    const sid = "";
    const md5 = createHash("md5");
    const ridRefreshToken = rid + this.tokenInfo.refreshToken;
    md5.update(ridRefreshToken, "utf-8");
    const hashKey = md5.digest("hex");
    const secret = _secretGenerating(rid, sid, hashKey);

    let queryEncData = "";
    let requestParams = params;
    if (params && Object.keys(params).length > 0) {
      queryEncData = _aesGcmEncrypt(_formToJson(params), secret);
      requestParams = { encdata: queryEncData };
    }

    let bodyEncData = "";
    let requestBody = body;
    if (body && Object.keys(body).length > 0) {
      bodyEncData = _aesGcmEncrypt(_formToJson(body), secret);
      requestBody = { encdata: bodyEncData };
    }

    const t = Date.now();
    const headers = new Map<string, string>();
    headers.set("X-appKey", TuyaSharingService.clientId);
    headers.set("X-requestId", rid);
    headers.set("X-sid", sid);
    headers.set("X-time", t.toString());
    headers.set("X-token", this.tokenInfo.accessToken);
    headers.set("X-sign", _restfulSign(hashKey, queryEncData, bodyEncData, headers));

    const url = `${this.tokenInfo.endpoint}${path}`;
    const res = await axios.request({
      method,
      url,
      params: requestParams,
      headers: Object.fromEntries(headers),
      data: requestBody ? JSON.stringify(requestBody) : undefined,
      timeout: 15000,
    });

    const ret = res.data as TuyaResponse<any>;
    if (!ret) throw new Error("Failed to receive response from Tuya Sharing API");

    return {
      ...ret,
      result:
        typeof ret.result === "string"
          ? (JSON.parse(_aesGcmDecrypt(ret.result, secret)) as T)
          : ret.result,
    };
  }

  private async refreshTokenIfNeeded(): Promise<void> {
    if (!this.tokenInfo) return;
    if (this.updatingTokenPromise) {
      await this.updatingTokenPromise;
    } else {
      this.updatingTokenPromise = this._internalRefreshTokenIfNeeded().finally(() => {
        this.updatingTokenPromise = null;
      });
      await this.updatingTokenPromise;
    }
  }

  private async _internalRefreshTokenIfNeeded(): Promise<void> {
    if (!this.tokenInfo || this.tokenInfo.expires > Date.now() + 60_000) return;

    try {
      const response = await this._request<{
        accessToken: string;
        refreshToken: string;
        uid: string;
        expireTime?: number;
      }>("GET", `/v1.0/m/token/${this.tokenInfo.refreshToken}`, undefined, undefined, true);

      if (!response.success || !response.result) {
        throw new Error("Failed to refresh token");
      }

      this.tokenInfo = {
        ...this.tokenInfo,
        expires: (response.t ?? Date.now()) + (response.result.expireTime ?? 7200) * 1000,
        accessToken: response.result.accessToken,
        refreshToken: response.result.refreshToken,
      };
      await this.saveToken(this.tokenInfo);
    } catch (e: any) {
      this.logger.error(`Tuya Sharing token refresh failed: ${e.message}`);
    }
  }

  public async generateQRCode(
    userCode: string,
  ): Promise<{ qrcode: string; qrDataUrl: string; userCode: string }> {
    const res = await axios.post(
      "https://apigw.iotbing.com/v1.0/m/life/home-assistant/qrcode/tokens",
      undefined,
      {
        params: {
          clientid: TuyaSharingService.clientId,
          usercode: userCode,
          schema: "haauthorize",
        },
      },
    );
    const data = res.data as TuyaResponse<{ qrcode: string }>;
    if (!data.success || !data.result?.qrcode) {
      throw new Error(data.errorMsg || data.msg || "Failed to generate Smart Life QR Code");
    }
    const qrcode = data.result.qrcode;
    const payload = `tuyaSmart--qrLogin?token=${qrcode}`;
    const QRCode = await import("qrcode");
    const qrDataUrl = await QRCode.default.toDataURL(payload, { width: 320, margin: 2 });
    return { qrcode, qrDataUrl, userCode };
  }

  public async pollQRCode(qrcode: string, userCode: string): Promise<TuyaSharingTokenInfo | null> {
    const res = await axios.get(
      `https://apigw.iotbing.com/v1.0/m/life/home-assistant/qrcode/tokens/${qrcode}`,
      {
        params: {
          clientid: TuyaSharingService.clientId,
          usercode: userCode,
        },
      },
    );
    const data = res.data as TuyaResponse<{
      access_token: string;
      refresh_token: string;
      uid: string;
      expire_time?: number;
      terminal_id: string;
      endpoint: string;
      username: string;
    }>;
    if (data.success && data.result?.access_token) {
      const token: TuyaSharingTokenInfo = {
        userCode,
        uid: data.result.uid,
        expires: (data.t ?? Date.now()) + (data.result.expire_time ?? 7200) * 1000,
        accessToken: data.result.access_token,
        refreshToken: data.result.refresh_token,
        terminalId: data.result.terminal_id,
        endpoint: data.result.endpoint,
        username: data.result.username,
      };
      await this.saveToken(token);
      return token;
    }
    return null;
  }
}
