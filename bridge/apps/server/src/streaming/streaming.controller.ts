import { Controller, Get, Param, NotFoundException, Inject } from "@nestjs/common";
import { StreamingService } from "./streaming.service.js";

@Controller("api/streaming")
export class StreamingController {
  constructor(@Inject(StreamingService) private readonly streamingService: StreamingService) {}

  @Get("status")
  async getAll() {
    return this.streamingService.getAllStreams();
  }

  @Get(":did")
  async getStream(@Param("did") did: string) {
    const info = await this.streamingService.getStreamInfo(did);
    if (!info) throw new NotFoundException("Stream not found");
    return info;
  }
}
