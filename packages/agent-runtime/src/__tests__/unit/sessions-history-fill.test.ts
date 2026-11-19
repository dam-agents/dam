// TEST_OVERVIEW: A session's replay read as data fills what the live transcript no longer holds from the harness's own history: when the transcript says the read needs it, the service reads the history provider once and asks the transcript again with it, and a read that needs nothing never touches the provider.
import { describe, expect, it } from "vitest";

import type { SessionMetadataStore } from "../../modules/acp/infrastructure/session-metadata-store.js";
import { createSessionChanges } from "../../modules/acp/services/session-changes.js";
import { createSessionsService } from "../../modules/acp/services/sessions-service.js";

const STORED = ["stored-1", "stored-2"];

function service(needsHistory: boolean) {
  const fetches: string[] = [];
  const asked: (readonly string[] | undefined)[] = [];
  const sessions = createSessionsService({
    subAgentContextOf: () => ({ harness: "claude-code", inherited: {} }),
    openCaller: () => {
      throw new Error("no harness");
    },
    sessionMetadata: {} as SessionMetadataStore,
    isRunning: () => false,
    changes: createSessionChanges(0),
    sessionFrames: (_sessionId, opts) => {
      asked.push(opts?.history);
      return {
        frames: opts?.history ? ["filled"] : ["placeholder"],
        truncated: false,
        needsHistory,
      };
    },
    historyProvider: {
      fetch: async (sessionId) => {
        fetches.push(sessionId);
        return STORED;
      },
    },
    delegations: { store: () => ({ truncated: false }), read: () => null },
    log: () => {},
  });
  return { sessions, fetches, asked };
}

describe("sessions.history fill from the harness history", () => {
  // TEST_SCENARIO: The transcript dropped an image in the read's range, so the read must come back filled from the provider's history, read once.
  it("reads the provider once and returns the filled frames", async () => {
    const { sessions, fetches, asked } = service(true);
    expect(await sessions.history("s1")).toEqual({
      frames: ["filled"],
      truncated: false,
    });
    expect(fetches).toEqual(["s1"]);
    expect(asked).toEqual([undefined, STORED]);
  });

  // TEST_SCENARIO: Everything the read returns is in memory, so the provider must not be read.
  it("does not read the provider when the transcript holds everything", async () => {
    const { sessions, fetches } = service(false);
    expect((await sessions.history("s1")).frames).toEqual(["placeholder"]);
    expect(fetches).toEqual([]);
  });
});
