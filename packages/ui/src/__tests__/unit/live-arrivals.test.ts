import { describe, expect, test } from "vitest";

import {
  newLiveArrivals,
  noteArrivals,
} from "../../modules/sessions/lib/live-arrivals.js";
import type { Message } from "../../types.js";

/**
 * TEST_OVERVIEW: Which user messages the chat eases into place.
 *
 * A message that arrives while the session is open — a batch moving in from
 * the queue, a message just sent — fades and slides in. Opening or reloading
 * a conversation animates nothing, and an arrival keeps its animation for
 * good, so the renders that follow never cut it off.
 */

function user(id: string): Message {
  return { id, role: "user", parts: [], streaming: false };
}

function reply(id: string): Message {
  return { id, role: "assistant", parts: [], streaming: true };
}

describe("noteArrivals", () => {
  /**
   * TEST_SCENARIO: The history a load brings, and what was there when the
   * session opened, must not animate; a batch arriving afterwards must.
   */
  test("eases in only what arrives after the session opened", () => {
    const state = newLiveArrivals("s1");
    noteArrivals(state, [], true);
    noteArrivals(state, [user("u1"), reply("a1")], true);
    noteArrivals(state, [user("u1"), reply("a1")], false);

    const arrived = noteArrivals(
      state,
      [user("u1"), reply("a1"), user("u2"), user("u2:1"), reply("a2")],
      false,
    );

    expect([...arrived]).toEqual(["u2", "u2:1"]);
  });

  /**
   * TEST_SCENARIO: The reply streaming after a batch keeps re-rendering the
   * chat. The batch must stay an arrival, or its animation would be cut off.
   */
  test("keeps an arrival through later renders", () => {
    const state = newLiveArrivals("s1");
    noteArrivals(state, [user("u1")], false);
    noteArrivals(state, [user("u1"), user("u2")], false);

    const arrived = noteArrivals(
      state,
      [user("u1"), user("u2"), reply("a2")],
      false,
    );

    expect([...arrived]).toEqual(["u2"]);
  });
});
