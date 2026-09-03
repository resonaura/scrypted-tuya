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
import { StartQrSchema, PasswordLoginSchema } from "./dto.js";

@Controller("api/auth")
export class AuthController {
  constructor(
    @Inject(TuyaProtectService) private readonly tuyaProtect: TuyaProtectService,
    @Inject(forwardRef(() => CamerasService)) private readonly camerasService: CamerasService,
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
    return { success: true };
  }
}
