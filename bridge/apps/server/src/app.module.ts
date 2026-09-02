import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CameraEntity, SettingEntity } from "./db/entities/index.js";
import { AuthModule } from "./auth/auth.module.js";
import { CamerasModule } from "./cameras/cameras.module.js";
import { StreamingModule } from "./streaming/streaming.module.js";
import { WsModule } from "./ws/ws.module.js";
import { SystemController } from "./system/system.controller.js";
import { env } from "./config/env.js";

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: "better-sqlite3",
      database: env.SQLITE_PATH,
      entities: [CameraEntity, SettingEntity],
      synchronize: true,
      logging: false,
    }),
    AuthModule,
    CamerasModule,
    StreamingModule,
    WsModule,
  ],
  controllers: [SystemController],
})
export class AppModule {}
