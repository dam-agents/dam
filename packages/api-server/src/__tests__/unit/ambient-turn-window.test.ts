/**
 * TEST_OVERVIEW: The ambient turn window covers an Agent in a channel from
 * the start of its ambient turn until a grace period after the last such turn
 * there ends. Other Agents and other channels are not covered.
 */
import { describe, expect, it } from "vitest";
import { createAmbientTurnWindow } from "../../modules/channels/domain/ambient-turn-window.js";

describe("createAmbientTurnWindow", () => {
  it("covers an agent while its ambient turn runs", () => {
    const window = createAmbientTurnWindow();
    window.enter("a", "C1");
    expect(window.covers("a", "C1")).toBe(true);
    expect(window.covers("b", "C1")).toBe(false);
    expect(window.covers("a", "C2")).toBe(false);
  });

  /** TEST_SCENARIO: Slack sends the reply back after the turn ended, so the
   *  window stays open for the grace period and then closes. */
  it("stays open for the grace period after the turn ends", () => {
    let now = 0;
    const window = createAmbientTurnWindow({ graceMs: 1000, now: () => now });
    window.enter("a", "C1");
    window.leave("a", "C1");
    now = 999;
    expect(window.covers("a", "C1")).toBe(true);
    now = 1000;
    expect(window.covers("a", "C1")).toBe(false);
  });

  /** TEST_SCENARIO: One Agent can run ambient turns in two threads of one
   *  channel. The window stays open until the last of them ends. */
  it("stays open while another turn in the channel still runs", () => {
    let now = 0;
    const window = createAmbientTurnWindow({ graceMs: 10, now: () => now });
    window.enter("a", "C1");
    window.enter("a", "C1");
    window.leave("a", "C1");
    now = 100;
    expect(window.covers("a", "C1")).toBe(true);
    window.leave("a", "C1");
    now = 111;
    expect(window.covers("a", "C1")).toBe(false);
  });
});
