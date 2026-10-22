/**
 * TEST_OVERVIEW: Which Session a Claude Code model call belongs to, and
 * whether it is a side call, read from what Claude Code stamps on it: the
 * session and parent in the request metadata `user_id`, the
 * `x-claude-code-session-id` header, the subagent's `x-claude-code-agent-id`
 * and the request class the gateway hint headers carry. A parent stamp alone
 * marks no subagent, since a rewound Session's copy carries one too.
 */
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import {
  isSideCall,
  sessionOf,
  subagentSessionOf,
} from "../../modules/model-router/index.js";

const req = (headers: Record<string, string>): IncomingMessage =>
  ({ headers }) as unknown as IncomingMessage;
const userId = (ids: Record<string, string>) => ({
  metadata: { user_id: JSON.stringify({ device_id: "d", ...ids }) },
});
const agent = {
  "x-claude-code-session-id": "s1",
  "x-claude-code-agent-id": "a1",
};

describe("sessionOf for Claude Code", () => {
  /** TEST_SCENARIO: The metadata names the session. A rewound Session's
   * copy runs under a new id and names the original as its parent; it is a
   * Session of its own, so its calls are its own, not the original's. */
  it("reads the session from the metadata, a rewound copy as itself", () => {
    expect(
      sessionOf(
        req({ "x-claude-code-session-id": "s1" }),
        userId({ session_id: "s1" }),
      ),
    ).toEqual({ sessionId: "s1" });
    expect(
      sessionOf(
        req({ "x-claude-code-session-id": "copy" }),
        userId({ session_id: "copy", parent_session_id: "s1" }),
      ),
    ).toEqual({ sessionId: "copy" });
  });

  /** TEST_SCENARIO: A subagent run inside the session stamps the session
   * itself and its own agent id. A fork subagent runs in a forked
   * conversation that names the session as its parent, and so does a
   * subagent inside a rewound Session's copy, whose parent is the deleted
   * original: the handle carries both ids, and the Session among them wins.
   */
  it("marks a subagent's call by its agent id, with the conversation it was forked from", () => {
    expect(sessionOf(req(agent), userId({ session_id: "s1" }))).toEqual({
      sessionId: "a1",
      parentSessionId: "s1",
    });
    const forked = sessionOf(
      req(agent),
      userId({ session_id: "fork", parent_session_id: "s1" }),
    );
    expect(forked).toEqual({
      sessionId: "a1",
      parentSessionId: "fork",
      forkedFrom: "s1",
    });
    const sessions = new Set(["s1", "copy"]);
    expect(subagentSessionOf(forked!, (id) => sessions.has(id))).toBe("s1");
    const inCopy = sessionOf(
      req(agent),
      userId({ session_id: "copy", parent_session_id: "s1" }),
    );
    expect(subagentSessionOf(inCopy!, (id) => sessions.has(id))).toBe("copy");
    expect(subagentSessionOf({ sessionId: "s1" }, () => true)).toBeUndefined();
  });

  /** TEST_SCENARIO: A call whose metadata names no session is still the
   * session's through the header; one with neither names no session. */
  it("falls back to the session header", () => {
    expect(sessionOf(req({ "x-claude-code-session-id": "s1" }), {})).toEqual({
      sessionId: "s1",
    });
    expect(sessionOf(req({}), {})).toBeNull();
  });
});

describe("isSideCall", () => {
  /** TEST_SCENARIO: Claude Code classes a title or summary call as
   * auxiliary, a subagent's turn as subagent, a workflow agent's as
   * workflow and a side reply as side_reply; a call with a subagent's id
   * is the subagent's whatever its class. A main turn, a compaction and a
   * call without the class stay the conversation's. */
  it("marks the classes beside the conversation, not the conversation's", () => {
    for (const cls of ["auxiliary", "subagent", "workflow", "side_reply"])
      expect(isSideCall(req({ "x-claude-code-request-class": cls }))).toBe(
        true,
      );
    expect(
      isSideCall(
        req({
          "x-claude-code-request-class": "compaction",
          "x-claude-code-agent-id": "a1",
        }),
      ),
    ).toBe(true);
    expect(isSideCall(req({ "x-claude-code-request-class": "main" }))).toBe(
      false,
    );
    expect(
      isSideCall(req({ "x-claude-code-request-class": "compaction" })),
    ).toBe(false);
    expect(isSideCall(req({}))).toBe(false);
  });
});
