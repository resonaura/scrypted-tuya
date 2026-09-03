import { BadRequestException, Body, Controller, Delete, Inject, Param, Post } from "@nestjs/common";
import { BrowserWebRtcService } from "./browser-webrtc.service.js";

@Controller("api/streaming")
export class BrowserWebRtcController {
  constructor(@Inject(BrowserWebRtcService) private readonly browserWebRtc: BrowserWebRtcService) {}

  @Post(":did/webrtc")
  async create(@Param("did") did: string, @Body() body: { sdp?: string; type?: string }) {
    if (body.type !== "offer" || !body.sdp) throw new BadRequestException("Invalid WebRTC offer");
    try {
      return await this.browserWebRtc.create(did, body.sdp);
    } catch (error: any) {
      throw new BadRequestException(error?.message || "Unable to create WebRTC viewer");
    }
  }

  @Delete(":did/webrtc/:sessionId")
  stop(@Param("sessionId") sessionId: string) {
    this.browserWebRtc.stop(sessionId);
    return { success: true };
  }
}
