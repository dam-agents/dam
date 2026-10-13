// TEST_OVERVIEW: A session's replay read as data can ask for only its newest frames, so a reader that shows a long session at once does not move its whole log. The cut never splits a message and starts at the prompt of the turn it falls into; a read without a tail still returns everything.
import { describe, expect, it } from "vitest";

import type { SessionMetadataStore } from "../../modules/acp/infrastructure/session-metadata-store.js";
import { createSessionChanges } from "../../modules/acp/services/session-changes.js";
import { createSessionsService } from "../../modules/acp/services/sessions-service.js";

const frame = (sessionUpdate: string, messageId: string, text: string) =>
  JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "s1",
      update: { sessionUpdate, messageId, content: { type: "text", text } },
    },
  });

const log = [
  frame("user_message_chunk", "u1", "ask 1"),
  frame("agent_message_chunk", "a1", "r1"),
  frame("user_message_chunk", "u2", "ask 2"),
  frame("agent_message_chunk", "a2", "part one "),
  frame("agent_message_chunk", "a2", "part two"),
];

function service(live: string[], stored: string[] | null = null) {
  return createSessionsService({
    openCaller: () => {
      throw new Error("no harness");
    },
    sessionMetadata: {} as SessionMetadataStore,
    isRunning: () => false,
    changes: createSessionChanges(0),
    sessionFrames: () => ({ frames: live, truncated: false }),
    historyProvider: { fetch: async () => stored },
    delegations: { store: () => ({ truncated: false }), read: () => null },
    log: () => {},
  });
}

describe("sessions.history tail", () => {
  it("starts at the prompt of the turn the cut falls into", async () => {
    const history = await service(log).history("s1", { tail: 1 });
    expect(history).toEqual({ frames: log.slice(2), truncated: true });
  });

  it("cuts the provider's frames the same way", async () => {
    const history = await service([], log).history("s1", { tail: 3 });
    expect(history).toEqual({ frames: log.slice(2), truncated: true });
  });

  it("returns the whole log without a tail, or when the tail covers it", async () => {
    expect(await service(log).history("s1")).toEqual({
      frames: log,
      truncated: false,
    });
    expect(await service(log).history("s1", { tail: 50 })).toEqual({
      frames: log,
      truncated: false,
    });
  });
});
