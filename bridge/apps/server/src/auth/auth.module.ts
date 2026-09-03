import { Module, forwardRef } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { TuyaProtectService } from "./tuya-protect.service.js";
import { TuyaMqttService } from "./tuya-mqtt.service.js";
import { TuyaSharingService } from "./tuya-sharing.service.js";
import { CamerasModule } from "../cameras/cameras.module.js";

@Module({
  imports: [forwardRef(() => CamerasModule)],
  controllers: [AuthController],
  providers: [TuyaProtectService, TuyaMqttService, TuyaSharingService],
  exports: [TuyaProtectService, TuyaMqttService, TuyaSharingService],
})
export class AuthModule {}
