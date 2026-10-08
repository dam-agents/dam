import { describe, expect, it } from "vitest";
import { moveTerminalSlot } from "../../modules/terminal-slots.js";

const slot = (sessionId: string, terminalId: string) => ({
  sessionId,
  terminalId,
});

describe("moveTerminalSlot", () => {
  /** TEST_SCENARIO: Each /clear reports the PTY's terminal id. The second /clear must still find the slot after the first one re-keyed it. */
  it("follows the same PTY across repeated moves", () => {
    const pty = slot("a", "t1");
    const slots = new Map([["a", pty]]);

    expect(moveTerminalSlot(slots, "t1", "b")).toBe(pty);
    expect(moveTerminalSlot(slots, "t1", "c")).toBe(pty);

    expect([...slots.keys()]).toEqual(["c"]);
    expect(pty.sessionId).toBe("c");
  });

  /** TEST_SCENARIO: A session that already has its own PTY is never taken over, and an unknown terminal changes nothing. */
  it("leaves the slots alone when the target is taken or the terminal is unknown", () => {
    const slots = new Map([
      ["a", slot("a", "t1")],
      ["b", slot("b", "t2")],
    ]);

    expect(moveTerminalSlot(slots, "t1", "b")).toBeNull();
    expect(moveTerminalSlot(slots, "t9", "c")).toBeNull();
    expect([...slots.keys()]).toEqual(["a", "b"]);
  });
});
