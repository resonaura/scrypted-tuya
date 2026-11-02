import { open, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

function framePath(directory: string, slug: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(slug)) throw Error("invalid_camera");
  return join(directory, slug + ".last_live.jpg");
}

/** Only call after a real native/RTSP capture, never from the Offline card renderer. */
export async function saveLastLive(
  directory: string,
  slug: string,
  buffer: Buffer,
) {
  if (
    buffer.length < 4 ||
    buffer[0] !== 255 ||
    buffer[1] !== 216 ||
    buffer.at(-2) !== 255 ||
    buffer.at(-1) !== 217
  )
    throw Error("invalid_frame");
  const path = framePath(directory, slug);
  await writeFile(path + ".next", buffer);
  await rename(path + ".next", path);
}

export async function readLastLive(directory: string, slug: string) {
  const file = await open(framePath(directory, slug), "r");
  try {
    const stat = await file.stat();
    if (stat.size > 6 * 1024 ** 2) throw Error("invalid_frame");
    const buffer = await file.readFile();
    if (buffer.length < 4 || buffer[0] !== 255 || buffer[1] !== 216)
      throw Error("invalid_frame");
    return { buffer, at: stat.mtimeMs };
  } finally {
    await file.close();
  }
}
