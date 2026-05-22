import { describe, expect, it } from "vitest";
import type { Contribution } from "api-server-api";
import { hashContributions } from "../../modules/runtime-channel/services/state-builder.js";

describe("hashContributions", () => {
  it("is stable for the same input regardless of key order", () => {
    const a: Contribution[] = [
      {
        kind: "mcp-entry",
        name: "github",
        entry: { url: "https://example", type: "http" },
      },
    ];
    const b: Contribution[] = [
      {
        kind: "mcp-entry",
        name: "github",
        entry: { type: "http", url: "https://example" },
      },
    ];
    expect(hashContributions(a)).toBe(hashContributions(b));
  });

  it("differs when contribution list differs", () => {
    const a: Contribution[] = [
      { kind: "file", path: "a", content: "x", mergeMode: "overwrite" },
    ];
    const b: Contribution[] = [
      { kind: "file", path: "a", content: "y", mergeMode: "overwrite" },
    ];
    expect(hashContributions(a)).not.toBe(hashContributions(b));
  });

  it("empty list yields a deterministic hash", () => {
    expect(hashContributions([])).toBe(hashContributions([]));
  });
});
