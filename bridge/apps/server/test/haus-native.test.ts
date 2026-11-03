import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CameraBridgeProvider } from "@haus/bridge/provider";
import { CameraBridgeHttp } from "@haus/bridge/http";
import { HausNativeService } from "../src/cameras/haus-native.service.js";
import type { CamerasService } from "../src/cameras/cameras.service.js";

test("Tuya native route lists disconnected cameras without device keys or unsupported controls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tuya-native-haus-"));
  const provider = await new CameraBridgeProvider({
    directory,
    provider: "tuya",
    name: "Tuya",
  }).initialize();
  const camera = {
    id: "camera-one",
    did: "physical-one",
    name: "Narnia",
    category: "sp",
    productId: "known-camera",
    rtspPort: 8655,
    rtspPath: "live/narnia",
    online: false,
    localKey: "never-export-me",
    p2pConfig: "also-private",
  };
  const service = new HausNativeService({
    getAll: async () => [camera],
  } as unknown as CamerasService);
  (service as any).provider = provider;
  (service as any).http = new CameraBridgeHttp({
    provider,
    command: async () => assert.fail("No invented control"),
  });
  (service as any).host = () => "192.168.1.20";
  const server = createServer((req, res) => void service.handle(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port,
    base = `http://127.0.0.1:${port}`;
  try {
    const pairing = (await fetch(base + "/api/haus/v2/pairing", {
      method: "POST",
      headers: { "X-Haus-Client": "1" },
    }).then((response) => response.json())) as { code: string };
    const enrolled = await provider.enroll(pairing.code, randomUUID());
    const response = await fetch(base + "/api/haus/v2/inventory", {
        headers: { Authorization: `Bearer ${enrolled.token}` },
      }),
      text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(text.includes("never-export-me"), false);
    assert.equal(text.includes("also-private"), false);
    const inventory = JSON.parse(text);
    assert.equal(inventory.cameras[0].available, false);
    assert.deepEqual(inventory.cameras[0].entities, []);
    assert.equal(inventory.cameras[0].stream.transport, "p2p");
    assert.equal(
      inventory.cameras[0].stream.url,
      "rtsp://192.168.1.20:8655/live/narnia",
    );
    assert.equal((await fetch(base + "/api/haus/v2/inventory")).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await provider.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
