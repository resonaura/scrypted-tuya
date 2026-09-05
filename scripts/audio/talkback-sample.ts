import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getCamerasFromBridge(apiBase: string): Promise<any[]> {
  try {
    const res = await axios.get(`${apiBase}/api/cameras`, { timeout: 3000 });
    return res.data || [];
  } catch {
    return [];
  }
}

async function main() {
  console.log("🎙️ Tuya Talkback Sample (RTMP / Intercom wire format)\n");

  const bridgePort = process.env.PORT || "6766";
  const bridgeHost = process.env.BRIDGE_HOST || "localhost";
  const rtmpPort = process.env.RTMP_PORT || "1935";
  let apiBase = `http://${bridgeHost}:${bridgePort}`;

  let cameras = await getCamerasFromBridge(apiBase);
  if (cameras.length === 0 && !process.env.PORT) {
    // Also try legacy port 8656
    const altCameras = await getCamerasFromBridge(`http://${bridgeHost}:8656`);
    if (altCameras.length > 0) {
      cameras = altCameras;
      apiBase = `http://${bridgeHost}:8656`;
    }
  }
  const targetFilter = (
    process.argv.slice(2).find((a) => !a.toLowerCase().endsWith(".wav")) ||
    process.env.TARGET_CAM ||
    ""
  ).toLowerCase();

  let targetCam = cameras.find(
    (c: any) =>
      c.name?.toLowerCase().includes(targetFilter) ||
      c.did?.toLowerCase().includes(targetFilter),
  );

  if (!targetCam && cameras.length > 0) {
    targetCam = cameras[0];
  }

  const slug = targetCam
    ? targetCam.name
        ?.toLowerCase()
        .replace(/\bcamera\b/g, " ")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || targetCam.did
    : targetFilter || "tuya-cam";

  console.log(`🎯 Targeting Camera: ${targetCam?.name || slug} (${targetCam?.did || slug})\n`);

  const wavArgs = process.argv.slice(2).filter((a) => a.toLowerCase().endsWith(".wav"));
  const defaultWav = path.resolve(__dirname, "../../audio/plop.wav");
  const wavList = wavArgs.length
    ? wavArgs.map((w) => {
        const cands = [w, path.resolve(process.cwd(), w), path.resolve(__dirname, "../../audio", path.basename(w))];
        const found = cands.find((c) => fs.existsSync(c));
        return found || w;
      })
    : [defaultWav];

  for (const wav of wavList) {
    if (!fs.existsSync(wav)) {
      console.error(`❌ Audio file not found: ${wav}`);
      continue;
    }

    const rtmpUrl = `rtmp://${bridgeHost}:${rtmpPort}/talk/${slug}`;
    console.log(`\n▶ Streaming ${path.basename(wav)} -> ${rtmpUrl}`);

    await new Promise<void>((resolve, reject) => {
      // Stream audio with low-delay flags matching talkback specification
      const ffmpegArgs = [
        "-hide_banner",
        "-loglevel", "info",
        "-re",
        "-i", wav,
        "-vn",
        "-c:a", "aac",
        "-b:a", "16k",
        "-ar", "16000",
        "-ac", "1",
        "-f", "flv",
        rtmpUrl,
      ];

      const proc = spawn("ffmpeg", ffmpegArgs, { stdio: "inherit" });
      proc.on("close", (code) => {
        if (code === 0) {
          console.log(`✅ Finished ${path.basename(wav)} successfully!`);
          resolve();
        } else {
          console.warn(`⚠️ FFmpeg exited with code ${code}`);
          resolve();
        }
      });
      proc.on("error", (err) => {
        console.error(`❌ FFmpeg error: ${err.message}`);
        reject(err);
      });
    });

    await sleep(500);
  }

  console.log("\n🎉 Talkback playback complete.");
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
