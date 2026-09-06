import { Module, forwardRef } from "@nestjs/common";
import { StreamingModule } from "../streaming/streaming.module.js";
import { AppWebSocketGateway } from "./ws.gateway.js";

@Module({
  imports: [forwardRef(() => StreamingModule)],
  providers: [AppWebSocketGateway],
  exports: [AppWebSocketGateway],
})
export class WsModule {}
