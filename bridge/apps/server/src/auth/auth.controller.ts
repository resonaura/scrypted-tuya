import {
  Controller,
  Get,
  Post,
  All,
  Body,
  Query,
  Req,
  Res,
  BadRequestException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import axios from "axios";
import { TuyaProtectService } from "./tuya-protect.service.js";
import { CamerasService } from "../cameras/cameras.service.js";
import { StartQrSchema, PasswordLoginSchema, CaptchaInitSchema } from "./dto.js";

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

  @Post("captcha/init")
  async initCaptcha(@Body() body: unknown) {
    const parse = CaptchaInitSchema.safeParse(body || {});
    if (!parse.success) {
      throw new BadRequestException(parse.error.format());
    }
    try {
      return await this.tuyaProtect.initCaptcha(parse.data.region);
    } catch (e: any) {
      throw new BadRequestException(e.message || "Failed to initialize verification captcha");
    }
  }

  @All("captcha/proxy/*")
  async proxyCaptcha(@Req() req: any, @Res() res: any) {
    if (req.method === "OPTIONS") {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
      return res.status(200).send();
    }

    const subpath = req.url.replace(/^.*\/api\/auth\/captcha\/proxy/, "");
    const targetUrl = `https://captcha.cdn5th.com${subpath}`;
    const host = this.tuyaProtect.getHost();

    try {
      const bodyStr = req.body
        ? typeof req.body === "string"
          ? req.body
          : JSON.stringify(req.body)
        : undefined;

      const fRes = await fetch(targetUrl, {
        method: req.method,
        headers: {
          "Content-Type": "application/json",
          Origin: `https://${host}`,
          Referer: `https://${host}/login`,
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        body: bodyStr,
      });

      const data = await fRes.text();
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "*");
      res.header("Access-Control-Allow-Headers", "*");
      res.header(
        "Content-Type",
        fRes.headers.get("content-type") || "application/json",
      );
      return res.status(fRes.status).send(data);
    } catch (err: any) {
      return res.status(500).send({ error: err.message });
    }
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

  @Post("login")
  async passwordLogin(@Body() body: unknown) {
    const parse = PasswordLoginSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException(parse.error.format());
    }
    const { email, password, countryCode, region, securekey } = parse.data;
    try {
      const res = await this.tuyaProtect.passwordLogin(
        email,
        password,
        countryCode,
        region,
        securekey,
      );
      return { success: true, user: res };
    } catch (e: any) {
      throw new BadRequestException(
        e.message ||
          "Incorrect email or password. Please verify your Tuya / Smart Life credentials.",
      );
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
