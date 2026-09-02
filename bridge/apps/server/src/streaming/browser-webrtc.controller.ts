import { BadRequestException, Body, Controller, Delete, Param, Post } from "@nestjs/common";
import { BrowserWebRtcService } from "./browser-webrtc.service.js";

@Controller("api/streaming")
export class BrowserWebRtcController {
  constructor(private readonly browserWebRtc: BrowserWebRtcService) {}

  @Post(":did/webrtc")
  async create(@Param("did") did: string) {
    try {
      return await this.browserWebRtc.create(did);
    } catch (error: any) {
      throw new BadRequestException(error?.message || "Unable to create WebRTC viewer");
    }
  }

  @Post(":did/webrtc/:sessionId/answer")
  answer(
    @Param("sessionId") sessionId: string,
    @Body() body: { sdp?: string; type?: string },
  ) {
    if (body.type !== "answer" || !body.sdp) throw new BadRequestException("Invalid WebRTC answer");
    try {
      this.browserWebRtc.answer(sessionId, body.sdp);
      return { success: true };
    } catch (error: any) {
      throw new BadRequestException(error?.message || "Unable to apply WebRTC answer");
    }
  }

  @Delete(":did/webrtc/:sessionId")
  stop(@Param("sessionId") sessionId: string) {
    this.browserWebRtc.stop(sessionId);
    return { success: true };
  }
}
