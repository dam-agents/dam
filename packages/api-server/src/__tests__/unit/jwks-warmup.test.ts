import { describe, it, expect, vi } from "vitest";
import { startJwksWarmup } from "../../apps/api-server/jwks-warmup.js";
import { configureLogger } from "../../core/logger.js";

function capture() {
  const lines: string[] = [];
  configureLogger({ level: "info", write: (l) => lines.push(l) });
  return { records: () => lines.map((l) => JSON.parse(l)) };
}

describe("startJwksWarmup", () => {
  it("latches ready after the first successful fetch", async () => {
    capture();
    const warm = vi.fn().mockResolvedValue(undefined);
    const w = startJwksWarmup(warm, {
      initialMs: 1,
      maxMs: 1,
      timeoutMs: 1_000,
    });
    await w.done;
    expect(w.ready()).toBe(true);
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it("stays not-ready across failures, then latches on success", async () => {
    capture();
    const warm = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(undefined);
    const w = startJwksWarmup(warm, {
      initialMs: 1,
      maxMs: 1,
      timeoutMs: 1_000,
    });
    expect(w.ready()).toBe(false);
    await w.done;
    expect(w.ready()).toBe(true);
    expect(warm).toHaveBeenCalledTimes(3);
  });

  it("latches ready on give-up and logs an error", async () => {
    const cap = capture();
    const warm = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const w = startJwksWarmup(warm, { initialMs: 1, maxMs: 1, timeoutMs: 25 });
    await w.done;
    expect(w.ready()).toBe(true);
    expect(
      cap
        .records()
        .some((r) => r.level === "error" && String(r.msg).includes("gave up")),
    ).toBe(true);
  });
});
