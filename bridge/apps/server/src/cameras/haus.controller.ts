import { Controller, Get, Inject } from "@nestjs/common";
import { CamerasService } from "./cameras.service.js";

/** Camera-source handoff only: no session tokens, device keys or camera commands. */
@Controller("api/haus")
export class HausCamerasController {
  constructor(
    @Inject(CamerasService) private readonly cameras: CamerasService,
  ) {}
  @Get("cameras")
  capabilities() {
    return this.cameras.hausCapabilities();
  }
}
