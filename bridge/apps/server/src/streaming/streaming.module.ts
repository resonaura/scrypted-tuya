import { Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BrowserWebRtcController } from "./browser-webrtc.controller.js";
import { BrowserWebRtcService } from "./browser-webrtc.service.js";
import { RtmpService } from "./rtmp.service.js";
import { StreamingController } from "./streaming.controller.js";
import { StreamingService } from "./streaming.service.js";
import { TalkbackSessionService } from "./talkback-session.service.js";
import { TranscoderService } from "./transcoder.service.js";

@Module({
  imports: [forwardRef(() => AuthModule)],
  providers: [
    StreamingService,
    TranscoderService,
    BrowserWebRtcService,
    RtmpService,
    TalkbackSessionService,
  ],
  controllers: [StreamingController, BrowserWebRtcController],
  exports: [
    StreamingService,
    TranscoderService,
    BrowserWebRtcService,
    RtmpService,
    TalkbackSessionService,
  ],
})
export class StreamingModule {}
