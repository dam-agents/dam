import { describe, expect, it } from "vitest";

import { formatCores } from "../../modules/budgets/lib/format.js";
import {
  parseCpuMilli,
  parseMemoryMi,
  sizeToQuantities,
} from "../../modules/sandboxes/lib/quantity.js";

// Sizes originate from template YAML and operator-edited specs, not just the
// sliders' own "<n>m"/"<n>Mi" output — a misparse baselines the settings
// form to a fallback and saving would then rewrite the sandbox's real size
// (#2768 review, should-fix 3).
describe("parseCpuMilli", () => {
  it("parses cores, fractional cores, and millicores", () => {
    expect(parseCpuMilli("2")).toBe(2000);
    expect(parseCpuMilli("0.5")).toBe(500);
    expect(parseCpuMilli("500m")).toBe(500);
    expect(parseCpuMilli("1.5")).toBe(1500);
  });

  it("rejects garbage, zero, and negatives", () => {
    expect(parseCpuMilli(undefined)).toBeNull();
    expect(parseCpuMilli("")).toBeNull();
    expect(parseCpuMilli("abc")).toBeNull();
    expect(parseCpuMilli("0")).toBeNull();
    expect(parseCpuMilli("-1")).toBeNull();
  });
});

describe("parseMemoryMi", () => {
  it("parses binary suffixes including fractional Gi", () => {
    expect(parseMemoryMi("512Mi")).toBe(512);
    expect(parseMemoryMi("2Gi")).toBe(2048);
    expect(parseMemoryMi("1.5Gi")).toBe(1536);
    expect(parseMemoryMi("1Ti")).toBe(1024 * 1024);
    expect(parseMemoryMi("524288Ki")).toBe(512);
  });

  it("parses decimal suffixes and plain bytes", () => {
    expect(parseMemoryMi("1G")).toBe(954); // 1e9 bytes ≈ 953.67Mi
    expect(parseMemoryMi("1024M")).toBe(977);
    expect(parseMemoryMi("1073741824")).toBe(1024); // bytes
  });

  it("rejects garbage, zero, and unknown suffixes", () => {
    expect(parseMemoryMi(undefined)).toBeNull();
    expect(parseMemoryMi("abc")).toBeNull();
    expect(parseMemoryMi("0Gi")).toBeNull();
    expect(parseMemoryMi("1Xi")).toBeNull();
  });

  it("round-trips a slider-written size exactly", () => {
    const q = sizeToQuantities(1500, 1536);
    expect(q).toEqual({ cpu: "1500m", memory: "1536Mi" });
    expect(parseCpuMilli(q?.cpu)).toBe(1500);
    expect(parseMemoryMi(q?.memory)).toBe(1536);
  });
});

describe("formatCores", () => {
  it("keeps quarter-core precision", () => {
    expect(formatCores(250)).toBe("0.25");
    expect(formatCores(1500)).toBe("1.5");
    expect(formatCores(2000)).toBe("2");
  });
});
