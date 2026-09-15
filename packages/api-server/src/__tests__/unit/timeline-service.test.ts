import type { TimelineSpan } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  createDisabledTimelineService,
  createTimelineService,
  ownedTimelineScope,
  type TimelineReader,
  type UnattachedLog,
} from "../../modules/timeline/index.js";

/**
 * TEST_OVERVIEW: ownership resolves above the store, so the reader is a spy
 * that records the allowlist it was handed and never a real query.
 */

function spyReader(over: Partial<TimelineReader> = {}) {
  const seen: { ids: readonly string[] }[] = [];
  const reader: TimelineReader = {
    sessionSpans: async (ids) => {
      seen.push({ ids });
      return [];
    },
    logRecords: async (ids) => {
      seen.push({ ids });
      return [];
    },
    ...over,
  };
  return { reader, seen };
}

const owned = [
  { id: "a1", name: "one" },
  { id: "a2", name: null },
];

const log = (over: Partial<UnattachedLog>): UnattachedLog => ({
  at: "2026-09-14T12:00:00.000Z",
  spanId: "",
  traceId: "",
  event: "claude_code.api_request",
  severity: "INFO",
  service: "claude-code",
  agentId: "a1",
  invocationId: null,
  attributes: {},
  ...over,
});

const span = (over: Partial<TimelineSpan>): TimelineSpan => ({
  spanId: "s1",
  parentSpanId: "",
  name: "claude_code.llm_request",
  kind: "SPAN_KIND_INTERNAL",
  service: "claude-code",
  startedAt: "2026-09-14T12:00:00.000Z",
  durationMs: 100,
  statusCode: "STATUS_CODE_UNSET",
  statusMessage: "",
  agentId: "a1",
  invocationId: null,
  attributes: {},
  ...over,
});

const TURNS_QUERY = {
  agentId: "a1",
  sessionId: "s1",
  sinceHours: 24,
  limit: 100,
  spanLimit: 1000,
  logLimit: 1000,
};

describe("ownedTimelineScope", () => {
  it("spans every owned agent when none is named", () => {
    expect(ownedTimelineScope(owned, undefined)).toEqual(["a1", "a2"]);
  });

  it("narrows to the named agent when it is owned", () => {
    expect(ownedTimelineScope(owned, "a2")).toEqual(["a2"]);
  });

  it("yields an empty allowlist for an agent the caller does not own", () => {
    expect(ownedTimelineScope(owned, "someone-else")).toEqual([]);
  });
});

describe("createTimelineService", () => {
  it("hands the reader only the resolved allowlist", async () => {
    const { reader, seen } = spyReader();
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    await service.turns(TURNS_QUERY);

    expect(seen[0]?.ids).toEqual(["a1"]);
  });

  it("returns nothing, and never queries, for an unowned agent", async () => {
    // TEST_SCENARIO: naming another user's agent must not reach the store.
    const { reader, seen } = spyReader();
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turns({ ...TURNS_QUERY, agentId: "not-mine" });

    expect(result).toEqual({ available: true, turns: [], truncated: false });
    expect(seen).toHaveLength(0);
  });

  it("builds a turn from log records alone when the harness emitted no spans", async () => {
    /**
     * TEST_SCENARIO: span export is intermittent, so a turn known only to the
     * log table must still be listed, with its cost.
     */
    const { reader } = spyReader({
      logRecords: async () => [
        log({
          at: "2026-09-14T12:00:00.000Z",
          event: "claude_code.user_prompt",
        }),
        log({
          at: "2026-09-14T12:00:01.000Z",
          attributes: { cost_usd_micros: "12500", model: "opus" },
        }),
      ],
    });
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turns(TURNS_QUERY);

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.turns).toHaveLength(1);
      expect(result.turns[0]?.spanCount).toBe(0);
      expect(result.turns[0]?.recordCount).toBe(2);
      expect(result.turns[0]?.costUsd).toBeCloseTo(0.0125);
      expect(result.turns[0]?.models).toEqual(["opus"]);
    }
  });

  it("keeps the newest turns when the cap bites", async () => {
    /**
     * TEST_SCENARIO: reading oldest-first must not turn the row cap into a
     * window onto ancient history.
     */
    const { reader } = spyReader({
      logRecords: async () => [
        log({
          at: "2026-09-14T10:00:00.000Z",
          event: "claude_code.user_prompt",
        }),
        log({ at: "2026-09-14T10:00:01.000Z" }),
        log({
          at: "2026-09-14T11:00:00.000Z",
          event: "claude_code.user_prompt",
        }),
        log({ at: "2026-09-14T11:00:01.000Z" }),
        log({
          at: "2026-09-14T12:00:00.000Z",
          event: "claude_code.user_prompt",
        }),
        log({ at: "2026-09-14T12:00:01.000Z" }),
      ],
    });
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turns({ ...TURNS_QUERY, limit: 2 });

    expect(result.available && result.turns.map((t) => t.startedAt)).toEqual([
      "2026-09-14T11:00:00.000Z",
      "2026-09-14T12:00:00.000Z",
    ]);
    expect(result.available && result.truncated).toBe(true);
  });

  it("answers an empty turn rather than failing when nothing is in range", async () => {
    const { reader } = spyReader();
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turn({
      agentId: "a1",
      sessionId: "s1",
      from: "2026-09-14T12:00:00.000Z",
      to: "2026-09-14T12:00:05.000Z",
      spanLimit: 100,
      logLimit: 100,
    });

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.turn.spans).toHaveLength(0);
      expect(result.turn.durationMs).toBe(5000);
    }
  });

  it("never queries the store for a turn on an unowned agent", async () => {
    const { reader, seen } = spyReader();
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    await service.turn({
      agentId: "not-mine",
      sessionId: "s1",
      from: "2026-09-14T12:00:00.000Z",
      to: "2026-09-14T12:00:05.000Z",
      spanLimit: 100,
      logLimit: 100,
    });

    expect(seen).toHaveLength(0);
  });
});

describe("createDisabledTimelineService", () => {
  it("answers unavailable as a value rather than throwing", async () => {
    /**
     * TEST_SCENARIO: unlike spend, an empty timeline misreports nothing, so
     * the caller is told the backend is off instead of getting an error.
     */
    const service = createDisabledTimelineService();

    const result = await service.turns(TURNS_QUERY);

    expect(result.available).toBe(false);
  });
});

describe("turns line up with the conversation", () => {
  it("splits on the prompt that starts each turn", async () => {
    /**
     * TEST_SCENARIO: three prompts should read as three rows, whatever the
     * harness did or did not span in between.
     */
    const { reader } = spyReader({
      logRecords: async () => [
        log({
          at: "2026-09-14T12:00:00.000Z",
          event: "claude_code.user_prompt",
        }),
        log({ at: "2026-09-14T12:00:01.000Z" }),
        log({
          at: "2026-09-14T12:01:00.000Z",
          event: "claude_code.user_prompt",
        }),
        log({ at: "2026-09-14T12:01:01.000Z" }),
        log({
          at: "2026-09-14T12:02:00.000Z",
          event: "claude_code.user_prompt",
        }),
        log({ at: "2026-09-14T12:02:01.000Z" }),
      ],
      sessionSpans: async () => [
        span({ startedAt: "2026-09-14T12:01:00.500Z" }),
      ],
    });
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turns(TURNS_QUERY);

    expect(result.available && result.turns).toHaveLength(3);
    if (result.available) {
      expect(result.turns.map((t) => t.spanCount)).toEqual([0, 1, 0]);
      expect(result.turns.every((t) => t.prompted)).toBe(true);
    }
  });

  it("keeps records that arrived before any prompt rather than dropping them", async () => {
    /**
     * TEST_SCENARIO: the first turn of a session emitted its records before any
     * prompt event, and those records carry the cost.
     */
    const { reader } = spyReader({
      logRecords: async () => [
        log({
          at: "2026-09-14T12:00:00.000Z",
          attributes: { cost_usd_micros: "5000" },
        }),
        log({
          at: "2026-09-14T12:01:00.000Z",
          event: "claude_code.user_prompt",
        }),
        log({ at: "2026-09-14T12:01:01.000Z" }),
      ],
    });
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turns(TURNS_QUERY);

    expect(result.available && result.turns).toHaveLength(2);
    if (result.available) {
      expect(result.turns[0]?.prompted).toBe(false);
      expect(result.turns[0]?.costUsd).toBeCloseTo(0.005);
    }
  });

  it("folds an untraced record and a separately-traced span into one turn", async () => {
    /**
     * TEST_SCENARIO: the live install produced a turn whose records carried no
     * trace id at all while its span had one of its own — grouping on time
     * rather than on trace id is what keeps them together.
     */
    const { reader } = spyReader({
      logRecords: async () => [
        log({
          at: "2026-09-14T12:00:00.000Z",
          traceId: "",
          attributes: { cost_usd_micros: "7000" },
        }),
      ],
      sessionSpans: async () => [
        span({ startedAt: "2026-09-14T12:00:00.100Z" }),
      ],
    });
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turns(TURNS_QUERY);

    expect(result.available && result.turns).toHaveLength(1);
    if (result.available) {
      expect(result.turns[0]?.spanCount).toBe(1);
      expect(result.turns[0]?.recordCount).toBe(1);
      expect(result.turns[0]?.costUsd).toBeCloseTo(0.007);
    }
  });
});

describe("turn boundaries when the prompt event is missing", () => {
  it("splits a session's opening exchanges on an idle gap", async () => {
    /**
     * TEST_SCENARIO: the live install emitted no prompt event for a session's
     * first exchange, so without a second boundary two exchanges merged into
     * one row.
     */
    const { reader } = spyReader({
      logRecords: async () => [
        log({ at: "2026-09-14T12:00:00.000Z" }),
        log({ at: "2026-09-14T12:00:01.000Z" }),
        log({ at: "2026-09-14T12:05:00.000Z" }),
        log({
          at: "2026-09-14T12:10:00.000Z",
          event: "claude_code.user_prompt",
        }),
        log({ at: "2026-09-14T12:10:01.000Z" }),
      ],
    });
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turns(TURNS_QUERY);

    expect(result.available && result.turns).toHaveLength(3);
  });

  it("does not split on a quiet stretch inside a prompted turn", async () => {
    /**
     * TEST_SCENARIO: a long tool run goes silent for minutes, and that must not
     * read as a new exchange — the gap rule applies only before the first
     * prompt, where no better boundary exists.
     */
    const { reader } = spyReader({
      logRecords: async () => [
        log({
          at: "2026-09-14T12:00:00.000Z",
          event: "claude_code.user_prompt",
        }),
        log({ at: "2026-09-14T12:09:00.000Z" }),
      ],
    });
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turns(TURNS_QUERY);

    expect(result.available && result.turns).toHaveLength(1);
  });
});

describe("what counts as an exchange", () => {
  it("leaves session housekeeping out of the listing", async () => {
    /**
     * TEST_SCENARIO: a session opens with a connection record and no model
     * call, which is not a turn and has no message to sit beside.
     */
    const { reader } = spyReader({
      logRecords: async () => [
        log({
          at: "2026-09-14T12:00:00.000Z",
          event: "claude_code.mcp_server_connection",
        }),
        log({
          at: "2026-09-14T12:10:00.000Z",
          event: "claude_code.user_prompt",
        }),
        log({ at: "2026-09-14T12:10:01.000Z" }),
      ],
    });
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turns(TURNS_QUERY);

    expect(result.available && result.turns).toHaveLength(1);
  });

  it("keeps a turn that only errored, since it still happened", async () => {
    const { reader } = spyReader({
      logRecords: async () => [
        log({
          at: "2026-09-14T12:00:00.000Z",
          event: "claude_code.api_error",
        }),
      ],
    });
    const service = createTimelineService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turns(TURNS_QUERY);

    expect(result.available && result.turns).toHaveLength(1);
  });
});
