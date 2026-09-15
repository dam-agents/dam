import { describe, expect, it } from "vitest";
import {
  AGENT_TELEMETRY_MAX_DAYS,
  AGENT_TELEMETRY_MAX_LIMIT,
  agentMetricsInputSchema,
  agentTelemetryInputSchema,
} from "api-server-api";
import type { TokenSpendByModel } from "api-server-api";
import {
  createAgentTelemetry,
  createUnavailableAgentTelemetry,
} from "../../modules/metrics/index.js";
import type {
  MetricsReader,
  MetricsWindow,
} from "../../modules/metrics/index.js";

// TEST_OVERVIEW: The agent-facing telemetry reads are how an agent sees its own runs — cost, calls, emitted records and span shape. Each must pin the query to exactly the calling agent (the isolation boundary: an agent may never reach another's telemetry), bound the window and the row count at the schemas the tools parse with, carry a session narrowing through to the reader, and degrade to an explicit available=false rather than throwing when no telemetry backend is installed.

function spend(model: string, costUsd: number, durationMs: number) {
  return {
    model,
    calls: 1,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd,
    durationMs,
  } satisfies TokenSpendByModel;
}

function session(sessionId: string, totalDurationMs: number) {
  return {
    sessionId,
    agentId: "agent-a",
    calls: 2,
    totalDurationMs,
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    firstAt: "2026-09-01T00:00:00Z",
    lastAt: "2026-09-01T00:05:00Z",
  };
}

interface Seen {
  ids: string[];
  window: MetricsWindow;
  limit?: number;
}

function reader(
  byModel: TokenSpendByModel[] = [],
  sessions: ReturnType<typeof session>[] = [],
  traceIds: string[] = ["t-1"],
) {
  const seen: Seen[] = [];
  const note = (
    ids: readonly string[],
    window: MetricsWindow,
    limit?: number,
  ) =>
    seen.push({
      ids: [...ids],
      window,
      ...(limit === undefined ? {} : { limit }),
    });
  const r: MetricsReader = {
    tokenSpendByModel: async (ids, window) => {
      note(ids, window);
      return byModel;
    },
    runtimeBySession: async (ids, window) => {
      note(ids, window);
      return sessions;
    },
    contextPerCall: async (ids, window, limit) => {
      note(ids, window, limit);
      return [];
    },
    telemetryEvents: async (ids, window, limit) => {
      note(ids, window, limit);
      return [];
    },
    sessionTraceIds: async (ids, window) => {
      note(ids, window);
      return traceIds;
    },
    traceSpans: async (ids, window, limit) => {
      note(ids, window, limit);
      return [];
    },
    spendByAgent: async () => [],
    spendByDay: async () => [],
    spendBySession: async () => [],
    close: async () => {},
  };
  return { r, seen };
}

describe("agent telemetry", () => {
  /**
   * TEST_SCENARIO: The isolation boundary. Every read must query with exactly
   * the calling agent's id — widening any one of them would let an agent read
   * its owner's whole fleet through a surface the platform scopes to one agent.
   */
  it("pins every read to the calling agent", async () => {
    const { r, seen } = reader();
    const svc = createAgentTelemetry({ reader: r });
    const query = { days: 7, limit: 10 };
    await svc.metrics("agent-a", { ...query, granularity: "summary" });
    await svc.metrics("agent-a", { ...query, granularity: "call" });
    await svc.logs("agent-a", query);
    await svc.spans("agent-a", query);
    expect(seen.length).toBeGreaterThan(4);
    expect(
      seen.every((s) => s.ids.length === 1 && s.ids[0] === "agent-a"),
    ).toBe(true);
  });

  // TEST_SCENARIO: The per-session breakdown is the answer to "why was that run slow" — it must reach the caller rather than being collapsed to a count.
  it("reports per-session detail alongside the totals", async () => {
    const { r } = reader(
      [spend("m1", 1.5, 400), spend("m2", 0.25, 100)],
      [session("s1", 300), session("s2", 200)],
    );
    const svc = createAgentTelemetry({ reader: r });
    const result = await svc.metrics("agent-a", {
      days: 7,
      limit: 50,
      granularity: "session",
    });
    expect(result).toMatchObject({
      available: true,
      totalCostUsd: 1.75,
      totalDurationMs: 500,
      sessionCount: 2,
    });
    expect(
      result.available && result.sessions?.map((s) => s.sessionId),
    ).toEqual(["s1", "s2"]);
  });

  // TEST_SCENARIO: A session narrowing has to reach the reader, since that is where the trace-aware fold lives; dropping it here would silently answer for every session the agent ran.
  it("carries a session narrowing through to the reader", async () => {
    const { r, seen } = reader();
    const svc = createAgentTelemetry({ reader: r });
    await svc.metrics("agent-a", {
      days: 7,
      limit: 50,
      granularity: "summary",
      sessionId: "s-1",
    });
    expect(seen.every((s) => s.window.sessionId === "s-1")).toBe(true);
    const result = await svc.spans("agent-a", {
      days: 7,
      limit: 5,
      sessionId: "s-1",
    });
    expect(result).toMatchObject({ available: true, sessionId: "s-1" });
  });

  // TEST_SCENARIO: The window the service reports must be the one it measured, so a caller can tell which period a figure covers.
  it("measures and reports the window it was given", async () => {
    const { r, seen } = reader();
    const svc = createAgentTelemetry({ reader: r });
    const result = await svc.metrics("agent-a", {
      days: AGENT_TELEMETRY_MAX_DAYS,
      limit: 50,
      granularity: "summary",
    });
    expect(result).toMatchObject({
      available: true,
      windowDays: AGENT_TELEMETRY_MAX_DAYS,
    });
    expect(seen[0]?.window).toEqual({ hours: AGENT_TELEMETRY_MAX_DAYS * 24 });
  });

  // TEST_SCENARIO: A row cap keeps one tool call from dragging back the whole retained window. The reader is asked for one row past the page on purpose — that extra row is what tells truncation apart from a page that merely came out full — so the bound the store sees is still the caller's, plus exactly one.
  it("asks the reader for one row past the caller's page", async () => {
    const { r, seen } = reader();
    const svc = createAgentTelemetry({ reader: r });
    await svc.metrics("agent-a", { days: 7, limit: 3, granularity: "call" });
    await svc.logs("agent-a", { days: 7, limit: 3 });
    await svc.spans("agent-a", { days: 7, limit: 3 });
    expect(
      seen.filter((s) => s.limit !== undefined).map((s) => s.limit),
    ).toEqual([4, 4, 4]);
  });

  /**
   * TEST_SCENARIO: The telemetry store retains a bounded window and a tool call
   * must not widen into a whole-retention scan. The input schemas are the single
   * owner of both bounds — they are what the agent-facing tools parse with — so
   * the rejection happens there, before the reader is asked for what it cannot
   * answer.
   */
  it("refuses a window or a page larger than the bounds", () => {
    expect(
      agentTelemetryInputSchema.safeParse({
        days: AGENT_TELEMETRY_MAX_DAYS + 1,
      }).success,
    ).toBe(false);
    expect(
      agentTelemetryInputSchema.safeParse({ days: AGENT_TELEMETRY_MAX_DAYS })
        .success,
    ).toBe(true);
    expect(
      agentTelemetryInputSchema.safeParse({
        limit: AGENT_TELEMETRY_MAX_LIMIT + 1,
      }).success,
    ).toBe(false);
    expect(
      agentTelemetryInputSchema.safeParse({
        limit: AGENT_TELEMETRY_MAX_LIMIT,
      }).success,
    ).toBe(true);
  });

  // TEST_SCENARIO: Detail level is an argument rather than a separate tool, so its default decides what an agent that just asks "what did I cost" pays for — it must be the cheapest level, not a row dump.
  it("defaults to the summary granularity and fetches no rows for it", async () => {
    expect(agentMetricsInputSchema.parse({}).granularity).toBe("summary");
    const { r } = reader([spend("m1", 1, 100)], [session("s1", 100)]);
    const svc = createAgentTelemetry({ reader: r });
    const result = await svc.metrics("agent-a", {
      days: 7,
      limit: 50,
      granularity: "summary",
    });
    expect(result).toMatchObject({ available: true, sessionCount: 1 });
    expect(result.available && result.sessions).toBeUndefined();
    expect(result.available && result.calls).toBeUndefined();
  });

  // TEST_SCENARIO: An agent that names no window gets the cheap one, so an omitted argument cannot cost a full-retention scan.
  it("defaults to the cheap window and page", () => {
    const parsed = agentTelemetryInputSchema.parse({});
    expect(parsed.days).toBeLessThan(AGENT_TELEMETRY_MAX_DAYS);
    expect(parsed.limit).toBeLessThan(AGENT_TELEMETRY_MAX_LIMIT);
    expect(parsed.sessionId).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: The summary's totals and its session rollup come from two
   * separate queries, and the rollup is capped while the totals are not — so on
   * a busy window they legitimately disagree. The result must say so rather than
   * leave an agent to sum the rows it was given and conclude the total is wrong:
   * the count and totals stay whole-window, and truncation is flagged.
   */
  it("caps the session rollup while keeping the totals whole-window", async () => {
    const { r } = reader(
      [spend("m1", 9, 900)],
      [session("s1", 300), session("s2", 200), session("s3", 100)],
    );
    const svc = createAgentTelemetry({ reader: r });
    const result = await svc.metrics("agent-a", {
      days: 7,
      limit: 2,
      granularity: "session",
    });
    expect(result).toMatchObject({
      available: true,
      sessionCount: 3,
      totalCostUsd: 9,
      totalDurationMs: 900,
      truncated: true,
    });
    expect(result.available && result.sessions).toHaveLength(2);
    expect(result.available && result.totalsCover).toContain(
      "every session in the window",
    );
  });

  /**
   * TEST_SCENARIO: The truncation flag is the only thing telling an agent
   * whether its rows are the whole answer, so it must never be inferred from the
   * page being full — a window holding exactly the page size has dropped
   * nothing. Each read therefore asks for one row past the page and reports on
   * what came back. Every branch that sets the flag is covered here, at exactly
   * the boundary where inferring it would be wrong.
   */
  it("does not claim truncation when the rows exactly fill the page", async () => {
    const rowsFor = (n: number) => Array.from({ length: n }, () => ({}));
    const svc = createAgentTelemetry({
      reader: {
        tokenSpendByModel: async () => [],
        runtimeBySession: async () => rowsFor(2) as never,
        contextPerCall: async (_i, _w, limit) => rowsFor(limit - 1) as never,
        telemetryEvents: async (_i, _w, limit) => rowsFor(limit - 1) as never,
        traceSpans: async (_i, _w, limit) => rowsFor(limit - 1) as never,
        sessionTraceIds: async () => ["t-1"],
        spendByAgent: async () => [],
        spendByDay: async () => [],
        spendBySession: async () => [],
        close: async () => {},
      },
    });
    const q = { days: 7, limit: 2 };
    expect(
      await svc.metrics("agent-a", { ...q, granularity: "call" }),
    ).toMatchObject({ truncated: false });
    expect(
      await svc.metrics("agent-a", { ...q, granularity: "session" }),
    ).toMatchObject({ truncated: false });
    expect(await svc.logs("agent-a", q)).toMatchObject({ truncated: false });
    expect(await svc.spans("agent-a", q)).toMatchObject({ truncated: false });
    expect(
      await svc.spans("agent-a", { ...q, sessionId: "s-1" }),
    ).toMatchObject({ truncated: false });
  });

  // TEST_SCENARIO: The mirror of the boundary above — one row beyond the page must flag truncation on every read, and the reported rows must still be cut to the page the caller asked for.
  it("flags truncation and trims to the page when more rows exist", async () => {
    const rowsFor = (n: number) => Array.from({ length: n }, () => ({}));
    const svc = createAgentTelemetry({
      reader: {
        tokenSpendByModel: async () => [],
        runtimeBySession: async () => rowsFor(3) as never,
        contextPerCall: async (_i, _w, limit) => rowsFor(limit) as never,
        telemetryEvents: async (_i, _w, limit) => rowsFor(limit) as never,
        traceSpans: async (_i, _w, limit) => rowsFor(limit) as never,
        sessionTraceIds: async () => ["t-1"],
        spendByAgent: async () => [],
        spendByDay: async () => [],
        spendBySession: async () => [],
        close: async () => {},
      },
    });
    const q = { days: 7, limit: 2 };
    const call = await svc.metrics("agent-a", { ...q, granularity: "call" });
    expect(call).toMatchObject({ truncated: true });
    expect(call.available && call.calls).toHaveLength(2);
    const bySession = await svc.metrics("agent-a", {
      ...q,
      granularity: "session",
    });
    expect(bySession).toMatchObject({ truncated: true });
    expect(bySession.available && bySession.sessions).toHaveLength(2);
    const logs = await svc.logs("agent-a", q);
    expect(logs).toMatchObject({ truncated: true });
    expect(logs.available && logs.logs).toHaveLength(2);
    const spans = await svc.spans("agent-a", q);
    expect(spans).toMatchObject({ truncated: true });
    expect(spans.available && spans.spans).toHaveLength(2);
  });

  // TEST_SCENARIO: An untruncated rollup must not claim truncation, or the flag stops carrying information.
  it("does not flag truncation when every session fits", async () => {
    const { r } = reader([spend("m1", 1, 100)], [session("s1", 100)]);
    const svc = createAgentTelemetry({ reader: r });
    const result = await svc.metrics("agent-a", {
      days: 7,
      limit: 50,
      granularity: "session",
    });
    expect(result).toMatchObject({ truncated: false, sessionCount: 1 });
  });

  /**
   * TEST_SCENARIO: Spans carry no session id, so a narrowed span read resolves
   * the session's trace family from its call records — which a traces-only
   * harness does not have. An unresolvable narrowing must be reported as
   * unresolved: answering an empty list would read as "this session ran
   * nothing", which is a different and wrong claim.
   */
  it("reports an unresolvable span narrowing rather than an empty measurement", async () => {
    const { r, seen } = reader([], [], []);
    const svc = createAgentTelemetry({ reader: r });
    const result = await svc.spans("agent-a", {
      days: 7,
      limit: 10,
      sessionId: "s-unknown",
    });
    expect(result).toMatchObject({
      available: true,
      sessionId: "s-unknown",
      sessionUnresolved: true,
    });
    expect(result.available && result.spans).toEqual([]);
    expect(seen.some((s) => s.limit !== undefined)).toBe(false);
  });

  // TEST_SCENARIO: A span read with no session names nothing to resolve, so it must not pay for a trace-family lookup before answering.
  it("skips trace resolution when no session is named", async () => {
    const { r, seen } = reader();
    const svc = createAgentTelemetry({ reader: r });
    const result = await svc.spans("agent-a", { days: 7, limit: 10 });
    expect(result).not.toHaveProperty("sessionUnresolved");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.limit).toBe(11);
  });

  // TEST_SCENARIO: With no telemetry backend every read must answer available=false as a result, not throw — an error reads to a skill as a transient failure and invites retries or estimation.
  it("reports unavailable on every read when the backend is off", async () => {
    const svc = createUnavailableAgentTelemetry();
    const query = { days: 30, limit: 10 };
    const results = await Promise.all([
      svc.metrics("agent-a", { ...query, granularity: "summary" }),
      svc.metrics("agent-a", { ...query, granularity: "call" }),
      svc.logs("agent-a", query),
      svc.spans("agent-a", query),
    ]);
    expect(results.every((x) => x.available === false)).toBe(true);
  });
});
