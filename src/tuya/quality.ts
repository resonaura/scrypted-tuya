import { TuyaDevice, TuyaDeviceSchema, TuyaDeviceStatus } from "./const";

export type TuyaQualitySelection = {
  code: string;
  value: string;
  current?: TuyaDeviceStatus;
};

const QUALITY_CODE_PATTERNS = [
  /(^|_)(video_?)?quality($|_)/i,
  /(^|_)(video_?)?resolution($|_)/i,
  /(^|_)(video_?)?clarity($|_)/i,
  /(^|_)(video_?)?definition($|_)/i,
  /(^|_)stream_?quality($|_)/i,
];

// Tuya IPC SDKs commonly use 2 for SD and 4 for HD. OEM enum strings vary,
// so only explicitly recognised values are ranked. Unknown values are never sent.
const QUALITY_VALUE_SCORES = new Map<string, number>([
  ["ssuper", 100], ["super_ultra", 100], ["super-ultra", 100],
  ["superuhd", 100], ["super_uhd", 100], ["ultra", 90],
  ["uhd", 90], ["4k", 90], ["2k", 80], ["super", 80],
  ["high", 70], ["hd", 70], ["1080p", 70], ["4", 70],
  ["standard", 50], ["sd", 50], ["720p", 50], ["2", 50],
  ["medium", 40], ["normal", 40], ["low", 10],
  ["fluent", 10], ["smooth", 10],
]);

function codeScore(code: string): number {
  const normalized = code.toLowerCase();
  return QUALITY_CODE_PATTERNS.reduce(
    (score, pattern, index) => pattern.test(normalized) ? Math.max(score, QUALITY_CODE_PATTERNS.length - index) : score,
    0,
  );
}

function valueScore(value: string): number | undefined {
  return QUALITY_VALUE_SCORES.get(value.trim().toLowerCase());
}

function chooseSchema(schemas: TuyaDeviceSchema[]): TuyaDeviceSchema | undefined {
  return schemas
    .filter((schema) => schema.type === "Enum" && schema.mode !== "r" && codeScore(schema.code) > 0)
    .filter((schema) => schema.specs.range.some((value: string) => valueScore(value) !== undefined))
    .sort((a, b) => codeScore(b.code) - codeScore(a.code))[0];
}

export function selectMaximumQuality(device: Pick<TuyaDevice, "schema" | "status">): TuyaQualitySelection | undefined {
  const schema = chooseSchema(device.schema || []);
  if (!schema || schema.type !== "Enum") return;

  const ranked = schema.specs.range
    .map((value) => ({ value, score: valueScore(value) }))
    .filter((entry): entry is { value: string; score: number } => entry.score !== undefined)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) return;

  return {
    code: schema.code,
    value: best.value,
    current: (device.status || []).find((status) => status.code === schema.code),
  };
}
