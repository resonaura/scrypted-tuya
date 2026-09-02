import { Controller, Get } from "@nestjs/common";
import { env } from "../config/env.js";

@Controller("api/system")
export class SystemController {
  @Get("config")
  getConfig() {
    return {
      rtspBasePort: env.RTSP_BASE_PORT,
      serverPort: env.PORT,
      webPort: env.WEB_PORT,
      core: "C++23 ZeroLatency",
      version: "1.0.0",
    };
  }
}
