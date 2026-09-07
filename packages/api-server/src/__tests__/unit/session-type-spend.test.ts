import { describe, expect, it } from "vitest";
import type { SessionCategory } from "api-server-api";

import { createSessionTypeSpend } from "../../modules/metrics/index.js";

describe("spend by session type", () => {
  it("queries neither store when the Session costs flag is off", async () => {
    let reads = 0;
    let lookups = 0;
    const spend = createSessionTypeSpend({
      readSpend: async () => {
        reads++;
        return [];
      },
      categorizeSessions: async () => {
        lookups++;
        return new Map<string, SessionCategory>();
      },
      isEnabled: async () => false,
    });
    expect(await spend.breakdown(["a-1"], {})).toEqual([]);
    expect([reads, lookups]).toEqual([0, 0]);
  });

  it("folds each session into its category and books unknown sessions rather than dropping them", async () => {
    const spend = createSessionTypeSpend({
      readSpend: async () => [
        { sessionId: "s1", costUsd: 1 },
        { sessionId: "s2", costUsd: 5 },
        { sessionId: "gone", costUsd: 2 },
      ],
      categorizeSessions: async () =>
        new Map<string, SessionCategory>([
          ["s1", "chats"],
          ["s2", "scheduled"],
        ]),
      isEnabled: async () => true,
    });
    expect(await spend.breakdown(["a-1"], {})).toEqual([
      { category: "scheduled", costUsd: 5 },
      { category: "unknown", costUsd: 2 },
      { category: "chats", costUsd: 1 },
    ]);
  });
});
