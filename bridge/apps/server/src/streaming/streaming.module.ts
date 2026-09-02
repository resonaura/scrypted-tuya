import { Module } from "@nestjs/common";
import { StreamingService } from "./streaming.service.js";
import { StreamingController } from "./streaming.controller.js";
import { TranscoderService } from "./transcoder.service.js";
import { BrowserWebRtcService } from "./browser-webrtc.service.js";
import { BrowserWebRtcController } from "./browser-webrtc.controller.js";

@Module({
  providers: [StreamingService, TranscoderService, BrowserWebRtcService],
  controllers: [StreamingController, BrowserWebRtcController],
  exports: [StreamingService, TranscoderService],
})
export class StreamingModule {}
