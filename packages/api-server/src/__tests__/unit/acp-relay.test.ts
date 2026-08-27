import { describe, it, expect, vi, afterEach } from "vitest";
import { pollUntilReady } from "../../modules/agents/infrastructure/poll-until-ready.js";

describe("pollUntilReady", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns true immediately when isReady is true on the first attempt", async () => {
    const isReady = vi.fn().mockResolvedValue(true);
    const result = await pollUntilReady(isReady, {
      initialMs: 100,
      maxMs: 1000,
      timeoutMs: 10_000,
    });
    expect(result).toBe(true);
    expect(isReady).toHaveBeenCalledTimes(1);
  });

  it("returns true once isReady flips to true after several polls", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const isReady = vi.fn().mockImplementation(async () => ++calls >= 3);
    const resultPromise = pollUntilReady(isReady, {
      initialMs: 100,
      maxMs: 1000,
      timeoutMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await resultPromise).toBe(true);
    expect(calls).toBe(3);
  });

  it("returns false once the deadline is exceeded", async () => {
    vi.useFakeTimers();
    const isReady = vi.fn().mockResolvedValue(false);
    const resultPromise = pollUntilReady(isReady, {
      initialMs: 100,
      maxMs: 500,
      timeoutMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await resultPromise).toBe(false);
    expect(isReady.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("backs off exponentially, capped at maxMs", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const isReady = vi.fn().mockResolvedValue(false);
    const gaps: number[] = [];
    let last = Date.now();
    isReady.mockImplementation(async () => {
      const now = Date.now();
      gaps.push(now - last);
      last = now;
      return false;
    });

    const resultPromise = pollUntilReady(isReady, {
      initialMs: 100,
      maxMs: 500,
      timeoutMs: 5_000,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await resultPromise;

    expect(gaps[1]).toBe(100);
    expect(gaps[2]).toBe(150);
    expect(gaps[3]).toBe(225);
    expect(gaps[4]).toBe(337);
    const latest = gaps.slice(5);
    expect(latest.every((g) => g === 500)).toBe(true);
  });
});
