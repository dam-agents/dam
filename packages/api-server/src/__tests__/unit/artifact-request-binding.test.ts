import { describe, expect, it } from "vitest";

import { resolveBinding } from "../../modules/artifact-library/domain/artifact-request-binding.js";

// TEST_OVERVIEW: Where a page asks is one decision, made from what the artifact already holds and what the ask offers. A page published `own_session` never binds: it takes its own Artifact Session, which is the only home that outlives the chat that made it. Every other page belongs to a conversation, and the first ask that carries one pins it. From then on the pinned one wins, whatever a later ask offers, so a page answered in one chat can never start driving another. An ask with no conversation behind it — the page opened from the Artifacts destination — binds nothing and lands in an Artifact Session, and so does every page published before this rule existed.

const bound = { ownSession: false, sessionId: "sess-7" };
const fresh = { ownSession: false, sessionId: null };
const own = { ownSession: true, sessionId: null };

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

  // TEST_SCENARIO: An ask from the Artifacts destination has no conversation to offer. The page asks in its own Artifact Session instead, and so does every page published before binding existed, whose `sessionId` is null.
  it("falls back to an Artifact Session when no conversation is offered", () => {
    expect(resolveBinding(fresh, null)).toEqual({ kind: "artifact-session" });
  });

  // TEST_SCENARIO: A page built to outlive the chat that made it must never bind to it, even though the app sends the open conversation with every ask.
  it("never binds an own_session page", () => {
    expect(resolveBinding(own, "sess-7")).toEqual({
      kind: "artifact-session",
    });
  });
});
