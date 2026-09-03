import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  BadRequestException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { TuyaProtectService } from "./tuya-protect.service.js";
import { TuyaSharingService } from "./tuya-sharing.service.js";
import { CamerasService } from "../cameras/cameras.service.js";
import { StartQrSchema, PasswordLoginSchema, PollQrSchema } from "./dto.js";
import { z } from "zod";

const SharingQrStartSchema = z.object({ userCode: z.string().min(1) });
const SharingQrPollSchema = z.object({ qrcode: z.string().min(1), userCode: z.string().min(1) });

@Controller("api/auth")
export class AuthController {
  constructor(
    @Inject(TuyaProtectService) private readonly tuyaProtect: TuyaProtectService,
    @Inject(TuyaSharingService) private readonly tuyaSharing: TuyaSharingService,
    @Inject(forwardRef(() => CamerasService)) private readonly camerasService: CamerasService,
  ) {}

  @Get("state")
  async getState() {
    return {
      ...this.tuyaProtect.getState(),
      sharingConfigured: this.tuyaSharing.isConfigured(),
    };
  }

  @Post("qr/start")
  async startQr(@Body() body: unknown) {
    const parse = StartQrSchema.safeParse(body || {});
    if (!parse.success) {
      throw new BadRequestException(parse.error.format());
    }
    return this.tuyaProtect.startQrFlow(parse.data.region);
  }

  @Get("qr/poll")
  async pollQr(@Query("token") token?: string) {
    return this.tuyaProtect.pollQr(token);
  }

  @Post("login")
  async passwordLogin(@Body() body: unknown) {
    const parse = PasswordLoginSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException(parse.error.format());
    }
    const { email, password, countryCode, region } = parse.data;
    const res = await this.tuyaProtect.passwordLogin(
      email,
      password,
      countryCode,
      region,
    );
    return { success: true, user: res };
  }

  @Post("logout")
  async logout() {
    await this.camerasService.logoutProfile();
    await this.tuyaProtect.logout();
    await this.tuyaSharing.logout();
    return { success: true };
  }

  // ---- Smart Life Sharing API (for cloud audio) ----

  @Post("sharing/qr/start")
  async startSharingQr(@Body() body: unknown) {
    const parse = SharingQrStartSchema.safeParse(body);
    if (!parse.success) throw new BadRequestException(parse.error.format());
    const { userCode } = parse.data;
    const result = await this.tuyaSharing.generateQRCode(userCode);
    return { success: true, ...result };
  }

  @Post("sharing/qr/poll")
  async pollSharingQr(@Body() body: unknown) {
    const parse = SharingQrPollSchema.safeParse(body);
    if (!parse.success) throw new BadRequestException(parse.error.format());
    const { qrcode, userCode } = parse.data;
    const token = await this.tuyaSharing.pollQRCode(qrcode, userCode);
    if (!token) return { success: false, pending: true };
    return { success: true, username: token.username };
  }
}
