import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  NotFoundException,
  BadRequestException,
  Res,
  Inject,
} from "@nestjs/common";
import { CamerasService } from "./cameras.service.js";
import {
  CreateCameraSchema,
  PtzSchema,
  type CreateCameraDto,
  type PtzDto,
} from "./dto.js";
import type { FastifyReply } from "fastify";

@Controller("api/cameras")
export class CamerasController {
  constructor(@Inject(CamerasService) private readonly camerasService: CamerasService) {}

  @Get()
  async getAll() {
    return this.camerasService.getAll();
  }

  @Get(":id")
  async getById(@Param("id") id: string) {
    const cam = await this.camerasService.getById(id);
    if (!cam) throw new NotFoundException("Camera not found");
    return cam;
  }

  @Post()
  async createOrUpdate(@Body() body: unknown) {
    const parse = CreateCameraSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException(parse.error.format());
    }
    return this.camerasService.createOrUpdate(parse.data);
  }

  @Delete(":id")
  async delete(@Param("id") id: string) {
    const ok = await this.camerasService.delete(id);
    if (!ok) throw new NotFoundException("Camera not found");
    return { success: true };
  }

  @Post(":id/start")
  async start(@Param("id") id: string) {
    const cam = await this.camerasService.getById(id);
    if (!cam) throw new NotFoundException("Camera not found");
    this.camerasService.startStream(cam);
    return {
      success: true,
      rtspUrl: `rtsp://127.0.0.1:${cam.rtspPort}/${cam.rtspPath}`,
    };
  }

  @Post(":id/stop")
  async stop(@Param("id") id: string) {
    const cam = await this.camerasService.getById(id);
    if (!cam) throw new NotFoundException("Camera not found");
    this.camerasService.stopStream(cam);
    return { success: true };
  }

  @Post(":id/ptz")
  async ptz(@Param("id") id: string, @Body() body: unknown) {
    const parse = PtzSchema.safeParse(body);
    if (!parse.success) throw new BadRequestException(parse.error.format());
    await this.camerasService.ptz(id, parse.data);
    return { success: true };
  }

  @Post("refresh")
  async refresh() {
    const cameras = await this.camerasService.refreshTuyaCameras();
    return { success: true, cameras };
  }

  @Get(":id/snapshot")
  async getSnapshot(@Param("id") id: string, @Res() res: FastifyReply) {
    const { buffer, mimeType } = await this.camerasService.getSnapshot(id);
    res.header("Content-Type", mimeType);
    res.header("Cache-Control", "no-cache, no-store, must-revalidate");
    return res.send(buffer);
  }

  @Get(":id/mjpeg")
  async getMjpegStream(@Param("id") id: string, @Res() res: FastifyReply) {
    res.raw.writeHead(200, {
      "Content-Type": "multipart/x-mixed-replace; boundary=--frame",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Connection": "close",
    });

    let active = true;
    const sendFrame = async () => {
      if (!active) return;
      try {
        const { buffer } = await this.camerasService.getSnapshot(id);
        if (active && buffer && buffer.length > 0) {
          res.raw.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${buffer.length}\r\n\r\n`);
          res.raw.write(buffer);
          res.raw.write("\r\n");
        }
      } catch {}
    };

    await sendFrame();
    const interval = setInterval(sendFrame, 400);

    res.raw.on("close", () => {
      active = false;
      clearInterval(interval);
    });
  }
}
