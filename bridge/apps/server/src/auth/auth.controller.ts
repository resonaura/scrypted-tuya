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
import { CamerasService } from "../cameras/cameras.service.js";
import { StartQrSchema } from "./dto.js";

@Controller("api/auth")
export class AuthController {
  constructor(
    @Inject(TuyaProtectService)
    private readonly tuyaProtect: TuyaProtectService,
    @Inject(forwardRef(() => CamerasService))
    private readonly camerasService: CamerasService,
  ) {}

  @Get("state")
  async getState() {
    return this.tuyaProtect.getState();
  }

  @Post("qr/start")
  async startQr(@Body() body: unknown) {
    const parse = StartQrSchema.safeParse(body || {});
    if (!parse.success) {
      throw new BadRequestException(parse.error.format());
    }
    try {
      return await this.tuyaProtect.startQrFlow(parse.data.region);
    } catch (e: any) {
      throw new BadRequestException(e.message || "Failed to start QR flow");
    }
  }

  @Get("qr/poll")
  async pollQr(@Query("token") token?: string) {
    try {
      return await this.tuyaProtect.pollQr(token);
    } catch (e: any) {
      throw new BadRequestException(e.message || "Failed to poll QR");
    }
  }

  @Post("logout")
  async logout() {
    try {
      await this.camerasService.logoutProfile();
      await this.tuyaProtect.logout();
      return { success: true };
    } catch (e: any) {
      throw new BadRequestException(e.message || "Failed to logout");
    }
  }
}
