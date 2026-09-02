import { Module } from "@nestjs/common";
import { StreamingService } from "./streaming.service.js";
import { StreamingController } from "./streaming.controller.js";
import { TranscoderService } from "./transcoder.service.js";

@Module({
  providers: [StreamingService, TranscoderService],
  controllers: [StreamingController],
  exports: [StreamingService, TranscoderService],
})
export class StreamingModule {}
