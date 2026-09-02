import "reflect-metadata";
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
    logger: env.NODE_ENV === "development",
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
  );

  app.useWebSocketAdapter(new WsAdapter(app));

  const corsOrigins = env.CORS_ORIGINS.split(",").map((o) => o.trim());
  app.enableCors({
    origin: corsOrigins.includes("*") ? true : corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  await app.listen(env.PORT, "0.0.0.0");

  console.log("\n======================================================");
  console.log("🚀 Tuya RTSP & P2P Media Bridge (Backend API) is running!");
  console.log(`📡 REST API & WebSockets: http://localhost:${env.PORT}`);
  console.log(
    `📹 RTSP Stream Base Port: rtsp://localhost:${env.RTSP_BASE_PORT}`,
  );
  console.log("======================================================\n");
}

bootstrap();
