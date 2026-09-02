import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { TuyaProtectService } from "./tuya-protect.service.js";
import { TuyaMqttService } from "./tuya-mqtt.service.js";

@Module({
  controllers: [AuthController],
  providers: [TuyaProtectService, TuyaMqttService],
  exports: [TuyaProtectService, TuyaMqttService],
})
export class AuthModule {}
