import { z } from "zod";
import * as dotenv from "dotenv";
import * as path from "node:path";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(6766),
  WEB_PORT: z.coerce.number().default(6767),
  RTSP_BASE_PORT: z.coerce.number().default(8655),
  RTMP_PORT: z.coerce.number().default(1935),
  RTSP_HOST: z.string().default(""),
  SQLITE_PATH: z
    .string()
    .default(path.join(process.cwd(), "data", "tuya-bridge.sqlite")),
  NATIVE_BIN_PATH: z.string().optional(),
  INGRESS_PATH: z.string().default(""),
  CORS_ORIGINS: z.string().default("*"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type EnvConfig = z.infer<typeof envSchema>;

function loadConfig(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error(
      "❌ [Config] Invalid environment variables:",
      result.error.format(),
    );
    process.exit(1);
  }
  return result.data;
}

export const env = loadConfig();
