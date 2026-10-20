import { describe, expect, it } from "vitest";
import { terminalBusy } from "../../modules/terminal-busy.js";

const GRACE = 30_000;
const IDLE = 5 * 60_000;

const detached = (over: {
  sinceDetachMs?: number;
  quietMs?: number;
  keptBackgroundWork?: boolean;
}) =>
  terminalBusy({
    attached: false,
    sinceDetachMs: over.sinceDetachMs ?? 10 * 60_000,
    quietMs: over.quietMs ?? 10 * 60_000,
    detachGraceMs: GRACE,
    idleReapMs: IDLE,
    keptBackgroundWork: over.keptBackgroundWork ?? false,
  });

describe("terminalBusy", () => {
  /** TEST_SCENARIO: A viewer is on the terminal, so the agent must not hibernate under them, however quiet the screen. */
  it("is busy while a viewer is attached", () => {
    expect(
      terminalBusy({
        attached: true,
        sinceDetachMs: 0,
        quietMs: 60 * 60_000,
        detachGraceMs: GRACE,
        idleReapMs: IDLE,
        keptBackgroundWork: false,
      }),
    ).toBe(true);
  });

  /** TEST_SCENARIO: A detached terminal the idle reap would not kill yet counts as busy, as it did before background work held terminals open. */
  it("is busy inside the detach grace or the idle window", () => {
    expect(detached({ sinceDetachMs: 1_000 })).toBe(true);
    expect(detached({ quietMs: 60_000 })).toBe(true);
  });

  /** TEST_SCENARIO: A quiet terminal held open only for a kept background task keeps the agent awake, as a chat session with kept work does. */
  it("is busy for kept background work", () => {
    expect(detached({ keptBackgroundWork: true })).toBe(true);
  });

  /** TEST_SCENARIO: A quiet terminal held open for background work the user stopped keeping lets the agent hibernate, as a chat session does. */
  it("is not busy for unkept background work on a quiet terminal", () => {
    expect(detached({ keptBackgroundWork: false })).toBe(false);
  });
});
