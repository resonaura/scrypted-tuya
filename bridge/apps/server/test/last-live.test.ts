import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLastLive, saveLastLive } from "../src/cameras/last-live.js";

test("Tuya real-only cache never serves generated Offline cards and survives restart with the original time", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tuya-haus-frame-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "side.jpg"), "Offline card");
  await assert.rejects(readLastLive(directory, "side"));
  const buffer = Buffer.from([255, 216, 1, 2, 255, 217]);
  await saveLastLive(directory, "side", buffer);
  await utimes(join(directory, "side.last_live.jpg"), 10, 10);
  assert.deepEqual(await readLastLive(directory, "side"), {
    buffer,
    at: 10000,
  });
  await assert.rejects(saveLastLive(directory, "../other", buffer));
  await assert.rejects(
    saveLastLive(directory, "side", Buffer.from("Offline card")),
  );
  assert.deepEqual((await readLastLive(directory, "side")).buffer, buffer);
});
