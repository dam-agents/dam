import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  SESSION_LOAD_TIMEOUT_MS,
  SessionLoadTimeoutError,
  withDeadline,
} from "../../modules/acp/deadline.js";
import {
  classifyResumeError,
  extractErrorMessage,
} from "../../modules/acp/errors.js";

describe("withDeadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("resolves with the promise's value when it settles in time", async () => {
    await expect(withDeadline(Promise.resolve("history"), 1_000)).resolves.toBe(
      "history",
    );
  });

  test("propagates the promise's own rejection", async () => {
    await expect(
      withDeadline(Promise.reject(new Error("load failed")), 1_000),
    ).rejects.toThrow("load failed");
  });

  test("rejects with SessionLoadTimeoutError once the deadline passes", async () => {
    const hung = withDeadline(new Promise<never>(() => {}), 1_000);
    const assertion = expect(hung).rejects.toBeInstanceOf(
      SessionLoadTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  test("a late settle after timeout does not throw unhandled", async () => {
    let settle!: (v: string) => void;
    const slow = new Promise<string>((resolve) => {
      settle = resolve;
    });
    const hung = withDeadline(slow, 1_000);
    const assertion = expect(hung).rejects.toBeInstanceOf(
      SessionLoadTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    settle("too late");
  });
});

describe("session-load timeout surfacing", () => {
  test("classifies as a connection failure", () => {
    expect(
      classifyResumeError(new SessionLoadTimeoutError(SESSION_LOAD_TIMEOUT_MS)),
    ).toBe("connection");
  });

  test("message names the budget and a next step", () => {
    const msg = extractErrorMessage(
      new SessionLoadTimeoutError(SESSION_LOAD_TIMEOUT_MS),
    );
    expect(msg).toMatch(/120s/);
    expect(msg).toMatch(/try again/i);
  });
});
