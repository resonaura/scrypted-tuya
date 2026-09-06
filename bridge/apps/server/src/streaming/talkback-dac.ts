/**
 * Merkury/Tuya p2pType-4 speaker path:
 * PT=0 μ-law is decoded to int16 LE, then each byte is played at 8 kHz.
 * We pick the μ-law byte whose decoded (LSB, MSB) pair is closest to two
 * consecutive signed 8-bit PCM ticks.
 *
 * Input for the live path is s16le 8 kHz mono (320 samples / 640 bytes per 40 ms frame).
 * Each pair of 8 kHz samples maps to 1 μ-law byte -> 160 μ-law bytes per 40 ms frame.
 * The camera plays each byte as 2 DAC ticks at 8 kHz (160 * 2 = 320 ticks = 40 ms),
 * matching real-time 1.0x tempo and pitch.
 */

const ULAW_SILENCE = 0xff;

function ulawToLinear(u: number): number {
  u = ~u & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

function linearToSignedBytes(s: number): [number, number] {
  const v = s & 0xffff;
  let b0 = v & 0xff;
  let b1 = (v >> 8) & 0xff;
  if (b0 >= 128) b0 -= 256;
  if (b1 >= 128) b1 -= 256;
  return [b0, b1];
}

const decBytes: Array<[number, number]> = Array.from({ length: 256 }, (_, u) =>
  linearToSignedBytes(ulawToLinear(u)),
);

/** LUT[(t0 & 0xff) | ((t1 & 0xff) << 8)] → μ-law byte. 64 KiB, built once. */
const PAIR_LUT = Buffer.alloc(65536);
for (let t0 = -128; t0 < 128; t0++) {
  for (let t1 = -128; t1 < 128; t1++) {
    let bestU = ULAW_SILENCE;
    let bestE = 1 << 30;
    for (let u = 0; u < 256; u++) {
      const [l, m] = decBytes[u];
      const e = (l - t0) * (l - t0) + (m - t1) * (m - t1);
      if (e < bestE) {
        bestE = e;
        bestU = u;
      }
    }
    const idx = (t0 & 0xff) | ((t1 & 0xff) << 8);
    PAIR_LUT[idx] = bestU;
  }
}

function s16leToS8(s16: Buffer): Int8Array {
  const n = s16.length >> 1;
  const s8 = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    const s = s16.readInt16LE(i * 2);
    s8[i] = s >> 8; // -128 .. 127, 0 is true silence
  }
  return s8;
}

/** Pack consecutive signed 8-bit ticks into μ-law. Drops a trailing odd byte. */
export function encodeDacUlawFromS8(s8: Int8Array): Buffer {
  const pairs = s8.length >> 1;
  const out = Buffer.allocUnsafe(pairs);
  for (let i = 0; i < pairs; i++) {
    const t0 = s8[i * 2];
    const t1 = s8[i * 2 + 1];
    out[i] = PAIR_LUT[(t0 & 0xff) | ((t1 & 0xff) << 8)];
  }
  return out;
}

/** s16le (any even length) → DAC μ-law. */
export function encodeDacUlawFromS16le(s16: Buffer): Buffer {
  const even = s16.length & ~1;
  return encodeDacUlawFromS8(s16leToS8(s16.subarray(0, even)));
}

export const TALKBACK_ULAW_FRAME = 160;
export const TALKBACK_FRAME_MS = 40;
export const TALKBACK_TS_INCREMENT = 320;
export const TALKBACK_S16_BYTES = 640; // 40 ms at 8 kHz s16le mono (320 samples)
export const TALKBACK_S16_16K_BYTES = TALKBACK_S16_BYTES; // alias for backwards compatibility
export const TALKBACK_ULAW_SILENCE = ULAW_SILENCE;
export const TALKBACK_RTP_SSRC = 0x12345678;

/** PT=0 PCMU, marker every packet. Clock is 8 kHz (ts += 320 / 40 ms). */
export function buildTalkbackRtp(
  ulaw: Buffer,
  seq: number,
  timestamp: number,
  ssrc = TALKBACK_RTP_SSRC,
): Buffer {
  const rtp = Buffer.alloc(12 + ulaw.length);
  rtp[0] = 0x80;
  rtp[1] = 0x80;
  rtp.writeUInt16BE(seq & 0xffff, 2);
  rtp.writeUInt32BE(timestamp >>> 0, 4);
  rtp.writeUInt32BE(ssrc >>> 0, 8);
  ulaw.copy(rtp, 12);
  return rtp;
}

/** ffmpeg filter: any RTMP codec → 8 kHz telephone band mono. */
export const TALKBACK_FFMPEG_FILTER =
  "aresample=8000:resampler=soxr:first_pts=0," +
  "highpass=f=300:poles=2," +
  "lowpass=f=3400:poles=2," +
  "volume=1.1";
