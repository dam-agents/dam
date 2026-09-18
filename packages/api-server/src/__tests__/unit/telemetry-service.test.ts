import type { TelemetrySpan } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  createDisabledTelemetryService,
  createTelemetryService,
  ownedTelemetryScope,
  scopeOwnedAgentIds,
  type TelemetryReader,
  type UnattachedLog,
} from "../../modules/telemetry/index.js";

/**
 * TEST_OVERVIEW: ownership resolves above the store, so the reader is a spy
 * that records the allowlist it was handed and never a real query.
 */

function spyReader(over: Partial<TelemetryReader> = {}) {
  const seen: { ids: readonly string[] }[] = [];
  const reader: TelemetryReader = {
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

const span = (over: Partial<TelemetrySpan>): TelemetrySpan => ({
  spanId: "s1",
  parentSpanId: "",
  traceId: "",
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

describe("ownedTelemetryScope", () => {
  it("spans every owned agent when none is named", () => {
    expect(ownedTelemetryScope(owned, undefined)).toEqual(["a1", "a2"]);
  });

  it("narrows to the named agent when it is owned", () => {
    expect(ownedTelemetryScope(owned, "a2")).toEqual(["a2"]);
  });

  it("yields an empty allowlist for an agent the caller does not own", () => {
    expect(ownedTelemetryScope(owned, "someone-else")).toEqual([]);
  });
});

describe("createTelemetryService", () => {
  it("hands the reader only the resolved allowlist", async () => {
    const { reader, seen } = spyReader();
    const service = createTelemetryService({
      reader,
      listOwnedAgents: async () => owned,
    });

    await service.turns(TURNS_QUERY);

    expect(seen[0]?.ids).toEqual(["a1"]);
  });

  it("returns nothing, and never queries, for an unowned agent", async () => {
    // TEST_SCENARIO: naming another user's agent must not reach the store.
    const { reader, seen } = spyReader();
    const service = createTelemetryService({
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
    const service = createTelemetryService({
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
    const service = createTelemetryService({
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
    const service = createTelemetryService({
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
    const service = createTelemetryService({
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

describe("createDisabledTelemetryService", () => {
  it("answers unavailable as a value rather than throwing", async () => {
    /**
     * TEST_SCENARIO: unlike spend, an empty timeline misreports nothing, so
     * the caller is told the backend is off instead of getting an error.
     */
    const service = createDisabledTelemetryService();

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
    const service = createTelemetryService({
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
    const service = createTelemetryService({
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
    const service = createTelemetryService({
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
    const service = createTelemetryService({
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
    const service = createTelemetryService({
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
    const service = createTelemetryService({
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
    const service = createTelemetryService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turns(TURNS_QUERY);

    expect(result.available && result.turns).toHaveLength(1);
  });
});

describe("a root span starts a turn", () => {
  it("splits two span-only exchanges that emitted no records at all", async () => {
    /**
     * TEST_SCENARIO: seen on a live install — two exchanges twenty seconds apart
     * produced spans and not one log record, so the prompt marker was absent and
     * both collapsed into a single turn covering the pair.
     */
    const { reader } = spyReader({
      logRecords: async () => [],
      sessionSpans: async () => [
        span({
          spanId: "a",
          name: "claude_code.llm_request",
          startedAt: "2026-09-16T11:35:47.575Z",
        }),
        span({
          spanId: "b",
          name: "claude_code.interaction",
          startedAt: "2026-09-16T11:36:07.373Z",
        }),
        span({
          spanId: "c",
          parentSpanId: "b",
          name: "claude_code.llm_request",
          startedAt: "2026-09-16T11:36:07.470Z",
        }),
      ],
    });
    const service = createTelemetryService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turns(TURNS_QUERY);

    expect(result.available && result.turns).toHaveLength(2);
    if (result.available) {
      expect(result.turns.map((t) => t.spanCount)).toEqual([1, 2]);
    }
  });

  it("keeps a child span with the root it belongs to", async () => {
    const { reader } = spyReader({
      logRecords: async () => [],
      sessionSpans: async () => [
        span({ spanId: "root", startedAt: "2026-09-16T12:00:00.000Z" }),
        span({
          spanId: "child",
          parentSpanId: "root",
          startedAt: "2026-09-16T12:00:30.000Z",
        }),
      ],
    });
    const service = createTelemetryService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turns(TURNS_QUERY);

    expect(result.available && result.turns).toHaveLength(1);
  });

  it("reads a prompt and the root span it opened as one exchange", async () => {
    /**
     * TEST_SCENARIO: both markers fire for the same exchange, milliseconds
     * apart, and must not read as two turns.
     */
    const { reader } = spyReader({
      logRecords: async () => [
        log({
          at: "2026-09-16T12:00:00.409Z",
          event: "claude_code.user_prompt",
        }),
        log({ at: "2026-09-16T12:00:03.000Z" }),
      ],
      sessionSpans: async () => [
        span({
          spanId: "root",
          name: "claude_code.interaction",
          startedAt: "2026-09-16T12:00:00.392Z",
        }),
      ],
    });
    const service = createTelemetryService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turns(TURNS_QUERY);

    expect(result.available && result.turns).toHaveLength(1);
  });
});

describe("turns are keyed by the harness prompt id", () => {
  const P1 = "5c1a9d3e-0001-4000-8000-000000000001";
  const P2 = "5c1a9d3e-0002-4000-8000-000000000002";
  const keyed = (promptId: string, over: Partial<UnattachedLog> = {}) =>
    log({
      ...over,
      attributes: { "prompt.id": promptId, ...(over.attributes ?? {}) },
    });

  it("lists one turn per prompt id, whatever the markers did", async () => {
    /**
     * TEST_SCENARIO: the second prompt emitted no prompt record and started
     * inside the marker debounce, so a time grouping would have folded it into
     * the first; the stamp says they are two exchanges.
     */
    const { reader } = spyReader({
      logRecords: async () => [
        keyed(P1, {
          at: "2026-09-16T12:00:00.000Z",
          event: "claude_code.user_prompt",
        }),
        keyed(P1, {
          at: "2026-09-16T12:00:01.000Z",
          attributes: { cost_usd_micros: "5000" },
        }),
        keyed(P2, {
          at: "2026-09-16T12:00:01.500Z",
          attributes: { cost_usd_micros: "7000" },
        }),
      ],
    });
    const service = createTelemetryService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turns(TURNS_QUERY);

    expect(result.available && result.turns.map((t) => t.turnId)).toEqual([
      P1,
      P2,
    ]);
    if (result.available) {
      expect(result.turns.map((t) => t.groupedBy)).toEqual([
        "prompt-id",
        "prompt-id",
      ]);
      expect(result.turns.map((t) => t.promptId)).toEqual([P1, P2]);
      expect(result.turns[0]?.costUsd).toBeCloseTo(0.005);
      expect(result.turns[1]?.costUsd).toBeCloseTo(0.007);
    }
  });

  it("joins a span to its prompt by trace id", async () => {
    const { reader } = spyReader({
      logRecords: async () => [
        keyed(P1, { at: "2026-09-16T12:00:00.000Z", traceId: "t1" }),
      ],
      sessionSpans: async () => [
        span({ traceId: "t1", startedAt: "2026-09-16T12:05:00.000Z" }),
      ],
    });
    const service = createTelemetryService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turns(TURNS_QUERY);

    expect(result.available && result.turns).toHaveLength(1);
    if (result.available) {
      expect(result.turns[0]?.spanCount).toBe(1);
      expect(result.turns[0]?.traceIds).toEqual(["t1"]);
    }
  });

  it("joins an untraced record and a separately-traced span by the records' window", async () => {
    /**
     * TEST_SCENARIO: the live install produced a turn whose records carried no
     * trace id while its root span had one of its own and opened milliseconds
     * before the prompt record.
     */
    const { reader } = spyReader({
      logRecords: async () => [
        keyed(P1, { at: "2026-09-16T12:00:00.409Z", traceId: "" }),
      ],
      sessionSpans: async () => [
        span({
          traceId: "t9",
          name: "claude_code.interaction",
          startedAt: "2026-09-16T12:00:00.392Z",
        }),
      ],
    });
    const service = createTelemetryService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turns(TURNS_QUERY);

    expect(result.available && result.turns).toHaveLength(1);
    if (result.available) {
      expect(result.turns[0]?.promptId).toBe(P1);
      expect(result.turns[0]?.spanCount).toBe(1);
    }
  });

  it("leaves a span outside every keyed turn to the time grouping", async () => {
    const { reader } = spyReader({
      logRecords: async () => [keyed(P1, { at: "2026-09-16T12:00:00.000Z" })],
      sessionSpans: async () => [
        span({ traceId: "tz", startedAt: "2026-09-16T12:30:00.000Z" }),
      ],
    });
    const service = createTelemetryService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turns(TURNS_QUERY);

    expect(result.available && result.turns.map((t) => t.groupedBy)).toEqual([
      "prompt-id",
      "time",
    ]);
    if (result.available) {
      expect(result.turns[1]?.promptId).toBeNull();
      expect(result.turns[1]?.turnId).toBe("2026-09-16T12:30:00.000Z");
    }
  });

  it("orders unkeyed turns among keyed ones by time", async () => {
    /**
     * TEST_SCENARIO: an older exchange with no stamp and a newer stamped one
     * must list oldest first, not stamped first.
     */
    const { reader } = spyReader({
      logRecords: async () => [
        log({
          at: "2026-09-16T11:00:00.000Z",
          event: "claude_code.user_prompt",
        }),
        log({ at: "2026-09-16T11:00:01.000Z" }),
        keyed(P1, { at: "2026-09-16T12:00:00.000Z" }),
      ],
    });
    const service = createTelemetryService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turns(TURNS_QUERY);

    expect(result.available && result.turns.map((t) => t.groupedBy)).toEqual([
      "time",
      "prompt-id",
    ]);
  });
});

describe("reading one turn", () => {
  function capturingReader() {
    const seen: { logFilter?: unknown; spanWindow?: unknown } = {};
    const reader: TelemetryReader = {
      sessionSpans: async (_ids, window) => {
        seen.spanWindow = window;
        return [];
      },
      logRecords: async (_ids, filter) => {
        seen.logFilter = filter;
        return [];
      },
    };
    return { reader, seen };
  }

  it("reads a keyed turn through a padded window narrowed to its prompt id", async () => {
    /**
     * TEST_SCENARIO: the prompt id already isolates the records, so the
     * padding admits the turn's own root span and its last record, never a
     * neighbour.
     */
    const { reader, seen } = capturingReader();
    const service = createTelemetryService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turn({
      agentId: "a1",
      sessionId: "s1",
      promptId: "p-1",
      from: "2026-09-16T12:00:00.000Z",
      to: "2026-09-16T12:00:05.000Z",
      spanLimit: 100,
      logLimit: 100,
    });

    expect(seen.logFilter).toEqual({
      fromIso: "2026-09-16T11:59:58.000Z",
      toIso: "2026-09-16T12:00:07.000Z",
      sessionId: "s1",
      promptId: "p-1",
    });
    expect(seen.spanWindow).toEqual({
      fromIso: "2026-09-16T11:59:58.000Z",
      toIso: "2026-09-16T12:00:07.000Z",
      sessionId: "s1",
    });
    expect(result.available && result.turn.turnId).toBe("p-1");
    expect(result.available && result.turn.promptId).toBe("p-1");
  });

  it("reads an unkeyed turn by its exact time range", async () => {
    const { reader, seen } = capturingReader();
    const service = createTelemetryService({
      reader,
      listOwnedAgents: async () => owned,
    });

    const result = await service.turn({
      agentId: "a1",
      sessionId: "s1",
      from: "2026-09-16T12:00:00.000Z",
      to: "2026-09-16T12:00:05.000Z",
      spanLimit: 100,
      logLimit: 100,
    });

    expect(seen.logFilter).toEqual({
      fromIso: "2026-09-16T12:00:00.000Z",
      toIso: "2026-09-16T12:00:05.000Z",
      sessionId: "s1",
    });
    expect(result.available && result.turn.turnId).toBe(
      "2026-09-16T12:00:00.000Z",
    );
    expect(result.available && result.turn.promptId).toBeNull();
  });
});

describe("scopeOwnedAgentIds — one rule for every transport", () => {
  it("unions live and registered agents so a deleted agent stays readable", () => {
    expect(
      scopeOwnedAgentIds({
        liveIds: ["live-only", "both"],
        registeredIds: ["both", "deleted"],
        granted: "*",
      }).sort(),
    ).toEqual(["both", "deleted", "live-only"]);
  });

  it("intersects with the key's granted scope", () => {
    expect(
      scopeOwnedAgentIds({
        liveIds: ["a1", "a2"],
        registeredIds: ["a3"],
        granted: ["a2"],
      }),
    ).toEqual(["a2"]);
  });

  it("narrows to one named agent, or yields nothing when it is not readable", () => {
    expect(
      scopeOwnedAgentIds({
        liveIds: ["a1"],
        registeredIds: ["a2"],
        granted: "*",
        agentId: "a2",
      }),
    ).toEqual(["a2"]);
    expect(
      scopeOwnedAgentIds({
        liveIds: ["a1"],
        registeredIds: [],
        granted: "*",
        agentId: "not-mine",
      }),
    ).toEqual([]);
  });

  it("reads a live agent the owner table has not caught up with", () => {
    /**
     * TEST_SCENARIO: the divergence this replaces — a live agent missing from
     * the registered set was readable in the conversation but exported empty.
     */
    expect(
      scopeOwnedAgentIds({
        liveIds: ["fresh"],
        registeredIds: [],
        granted: "*",
        agentId: "fresh",
      }),
    ).toEqual(["fresh"]);
  });
});
