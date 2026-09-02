import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { WsAdapter } from "@nestjs/platform-ws";
import { AppModule } from "./app.module.js";
import { env } from "./config/env.js";
import { initDatabase } from "./db/data-source.js";

async function bootstrap() {
  await initDatabase();

  const adapter = new FastifyAdapter({
    logger: process.env.LOG_LEVEL === "debug",
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    { bufferLogs: false },
  );
  app.enableShutdownHooks();
  app.useWebSocketAdapter(new WsAdapter(app));

  const corsOrigins = env.CORS_ORIGINS.split(",").map((o) => o.trim());
  app.enableCors({
    origin: corsOrigins.includes("*") ? true : corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  await app.listen(env.PORT, "0.0.0.0");
  Logger.log(`Tuya bridge ready: API :${env.PORT}, RTSP :${env.RTSP_BASE_PORT}`, "Bootstrap");

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    Logger.log(`Received ${signal}, stopping bridge`, "Bootstrap");
    const forceTimer = setTimeout(() => process.exit(1), 7000);
    forceTimer.unref();
    try {
      await app.close();
      clearTimeout(forceTimer);
      process.exit(0);
    } catch (error) {
      Logger.error(error, undefined, "Bootstrap");
      process.exit(1);
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

bootstrap().catch((error) => {
  Logger.error(error, undefined, "Bootstrap");
  process.exit(1);
});
