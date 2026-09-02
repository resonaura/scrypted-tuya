import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getNativeDir(): string {
  const candidates = [
    path.resolve(__dirname, "../../native"),
    path.resolve(__dirname, "../../../native"),
    path.resolve(__dirname, "../../../../apps/native"),
    path.resolve(process.cwd(), "../native"),
    path.resolve(process.cwd(), "apps/native"),
    path.resolve(process.cwd(), "bridge/apps/native"),
    path.resolve(process.cwd(), "native"),
    path.resolve(process.cwd(), "../apps/native"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.existsSync(path.join(c, "CMakeLists.txt"))) {
      return c;
    }
  }
  return candidates[0];
}

export function computeSourceHash(nativeDir: string): string {
  const hash = crypto.createHash("sha256");

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "build") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (
        entry.name.endsWith(".cpp") ||
        entry.name.endsWith(".hpp") ||
        entry.name.endsWith(".h") ||
        entry.name.endsWith(".c") ||
        entry.name === "CMakeLists.txt"
      ) {
        hash.update(entry.name);
        hash.update(fs.readFileSync(fullPath));
      }
    }
  }

  walk(nativeDir);
  return hash.digest("hex");
}

export function ensureNativeBinary(): string {
  if (env.NATIVE_BIN_PATH && fs.existsSync(env.NATIVE_BIN_PATH)) {
    return env.NATIVE_BIN_PATH;
  }

  const nativeDir = getNativeDir();
  const buildDir = path.join(nativeDir, "build");
  const binName =
    process.platform === "win32" ? "tuya-streamer.exe" : "tuya-streamer";
  const binPath = path.join(buildDir, binName);

  if (!fs.existsSync(binPath) && fs.existsSync(nativeDir)) {
    try {
      console.log(`🔨 [NativeEngine] Building C++ native engine (tuya-streamer)...`);
      fs.mkdirSync(buildDir, { recursive: true });
      execSync(`cmake -B "${buildDir}" "${nativeDir}" && cmake --build "${buildDir}" -j`, {
        stdio: "inherit",
      });
      console.log(`✅ [NativeEngine] tuya-streamer ready -> ${binPath}`);
    } catch (e: any) {
      console.error("❌ [NativeEngine] C++ build failed:", e.message);
    }
  }

  return binPath;
}

export const getNativeBinaryPath = ensureNativeBinary;
