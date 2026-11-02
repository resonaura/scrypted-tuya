import { HausCamerasController } from "./haus.controller.js";
import { Module, forwardRef } from "@nestjs/common";
import { CamerasController } from "./cameras.controller.js";
import { CamerasService } from "./cameras.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { StreamingModule } from "../streaming/streaming.module.js";

@Module({
  imports: [forwardRef(() => AuthModule), StreamingModule],
  controllers: [CamerasController, HausCamerasController],
  providers: [CamerasService],
  exports: [CamerasService],
})
export class CamerasModule {}
