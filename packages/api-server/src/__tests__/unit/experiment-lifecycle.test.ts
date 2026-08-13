import { describe, it, expect } from "vitest";
import {
  canTransition,
  isTerminal,
  sweepDecision,
} from "../../modules/experiments/domain/lifecycle.js";

describe("canTransition", () => {
  it("allows exactly the documented lifecycle", () => {
    expect(canTransition("draft", "running")).toBe(true);
    expect(canTransition("running", "completed")).toBe(true);
    expect(canTransition("running", "failed")).toBe(true);
    expect(canTransition("running", "stopped")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(canTransition("draft", "completed")).toBe(false);
    expect(canTransition("draft", "stopped")).toBe(false);
    expect(canTransition("completed", "running")).toBe(false);
    expect(canTransition("failed", "running")).toBe(false);
    expect(canTransition("stopped", "running")).toBe(false);
    expect(canTransition("running", "draft")).toBe(false);
  });
});

describe("isTerminal", () => {
  it("marks completed/failed/stopped terminal, draft/running not", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("stopped")).toBe(true);
    expect(isTerminal("draft")).toBe(false);
    expect(isTerminal("running")).toBe(false);
  });
});

describe("sweepDecision", () => {
  const now = new Date("2026-07-23T12:00:00Z");
  const windowMs = 15 * 60_000;

  it("keeps a running experiment active within the window", () => {
    expect(
      sweepDecision(
        {
          status: "running",
          lastActivityAt: "2026-07-23T11:50:00Z",
          executedAt: "2026-07-23T11:00:00Z",
        },
        now,
        windowMs,
      ),
    ).toBe("keep");
  });

  it("fails a running experiment silent past the window", () => {
    expect(
      sweepDecision(
        {
          status: "running",
          lastActivityAt: "2026-07-23T11:40:00Z",
          executedAt: "2026-07-23T11:00:00Z",
        },
        now,
        windowMs,
      ),
    ).toBe("fail");
  });

  it("keeps at exactly the window boundary (strictly-greater rule)", () => {
    expect(
      sweepDecision(
        {
          status: "running",
          lastActivityAt: "2026-07-23T11:45:00Z",
          executedAt: null,
        },
        now,
        windowMs,
      ),
    ).toBe("keep");
  });

  it("falls back to executedAt before any event arrived", () => {
    expect(
      sweepDecision(
        {
          status: "running",
          lastActivityAt: null,
          executedAt: "2026-07-23T11:00:00Z",
        },
        now,
        windowMs,
      ),
    ).toBe("fail");
    expect(
      sweepDecision(
        {
          status: "running",
          lastActivityAt: null,
          executedAt: "2026-07-23T11:55:00Z",
        },
        now,
        windowMs,
      ),
    ).toBe("keep");
  });

  it("never touches drafts or terminal experiments", () => {
    for (const status of ["draft", "completed", "failed", "stopped"] as const) {
      expect(
        sweepDecision(
          { status, lastActivityAt: "2020-01-01T00:00:00Z", executedAt: null },
          now,
          windowMs,
        ),
      ).toBe("keep");
    }
  });

  it("reaps rather than wedges a running row with no clock at all", () => {
    expect(
      sweepDecision(
        { status: "running", lastActivityAt: null, executedAt: null },
        now,
        windowMs,
      ),
    ).toBe("fail");
  });
});
