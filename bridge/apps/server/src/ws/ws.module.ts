import { Module } from "@nestjs/common";
import { AppWebSocketGateway } from "./ws.gateway.js";

@Module({
  providers: [AppWebSocketGateway],
  exports: [AppWebSocketGateway],
})
export class WsModule {}
