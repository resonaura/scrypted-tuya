import { describe, expect, test } from "bun:test";
import { selectMaximumQuality } from "../src/tuya/quality";

const device = (code: string, range: string[], current?: string) => ({
  schema: [{ code, mode: "rw" as const, type: "Enum" as const, specs: { range } }],
  status: current === undefined ? [] : [{ code, value: current }],
});

describe("selectMaximumQuality", () => {
  test("selects HD over SD", () => expect(selectMaximumQuality(device("video_quality", ["sd", "hd"], "sd"))?.value).toBe("hd"));
  test("selects highest profile", () => expect(selectMaximumQuality(device("video_definition", ["standard", "high", "ultra"]))?.value).toBe("ultra"));
  test("supports Tuya clarity values", () => expect(selectMaximumQuality(device("clarity", ["2", "4"]))?.value).toBe("4"));
  test("does not guess unknown enums", () => expect(selectMaximumQuality(device("video_quality", ["foo", "bar"]))).toBeUndefined());
  test("ignores unrelated DPs", () => expect(selectMaximumQuality(device("record_mode", ["event", "continuous"]))).toBeUndefined());
});
