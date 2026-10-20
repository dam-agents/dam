import { describe, expect, it } from "vitest";
import { terminalReap } from "../../modules/terminal-reap.js";

const IDLE = 5 * 60_000;
const RECHECK = 15_000;

describe("terminalReap", () => {
  /** TEST_SCENARIO: A detached terminal whose screen was quiet for the full idle window, with no background work reported, is abandoned and is killed. */
  it("kills a quiet terminal that holds no background work", () => {
    expect(
      terminalReap({
        quietMs: IDLE,
        idleReapMs: IDLE,
        holdsBackgroundWork: false,
        recheckMs: RECHECK,
      }),
    ).toEqual({ kind: "kill" });
  });

  /** TEST_SCENARIO: A terminal that printed recently is still working, so the reaper waits for the rest of the idle window. */
  it("waits out the rest of the idle window after recent output", () => {
    expect(
      terminalReap({
        quietMs: 60_000,
        idleReapMs: IDLE,
        holdsBackgroundWork: false,
        recheckMs: RECHECK,
      }),
    ).toEqual({ kind: "wait", ms: IDLE - 60_000 });
  });

  /** TEST_SCENARIO: The issue #4008 case. Claude finished its turn, so the screen is quiet, but a background command it started still runs. Killing the PTY would kill the command, so the reaper checks again later, as a chat session does. */
  it("never kills a terminal that holds background work, however quiet", () => {
    expect(
      terminalReap({
        quietMs: 60 * 60_000,
        idleReapMs: IDLE,
        holdsBackgroundWork: true,
        recheckMs: RECHECK,
      }),
    ).toEqual({ kind: "wait", ms: RECHECK });
  });
});
