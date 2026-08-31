import { describe, expect, it } from "vitest";

import { resolveBinding } from "../../modules/artifact-library/domain/artifact-request-binding.js";

// TEST_OVERVIEW: Where a page asks is one decision, made from what the artifact already holds and what the ask offers. Every page belongs to a conversation, and the first ask that carries one pins it. From then on the pinned one wins, whatever a later ask offers, so a page answered in one chat can never start driving another. An ask with no conversation behind it — the page opened from the Artifacts destination before any chat has asked it — has nowhere to land and is refused; no fallback session exists.

const bound = { sessionId: "sess-7" };
const fresh = { sessionId: null };

describe("choosing where a request lands", () => {
  // TEST_SCENARIO: The ask carries the conversation the app has open behind the page, and nothing is pinned yet, so this ask is what settles the page.
  it("pins the offered conversation when nothing is pinned", () => {
    expect(resolveBinding(fresh, "sess-7")).toEqual({
      kind: "pin",
      sessionId: "sess-7",
    });
  });

  // TEST_SCENARIO: Opening the page from the Artifacts destination, or from another chat, offers a different conversation. The page's whole life is settled, so the offer is ignored.
  it("keeps the pinned conversation over any later offer", () => {
    expect(resolveBinding(bound, "sess-99")).toEqual({
      kind: "bound",
      sessionId: "sess-7",
    });
    expect(resolveBinding(bound, null)).toEqual({
      kind: "bound",
      sessionId: "sess-7",
    });
  });

  // TEST_SCENARIO: An ask from the Artifacts destination has no conversation to offer, and the page is not pinned yet. There is no other home a page can have, so the ask is refused rather than served somewhere invisible.
  it("refuses an unbound ask that offers no conversation", () => {
    expect(resolveBinding(fresh, null)).toEqual({ kind: "not-bound" });
  });
});
