import { describe, expect, it } from "vitest";
import {
  AGENT_TELEMETRY_MAX_DAYS,
  AGENT_TELEMETRY_MAX_LIMIT,
  agentMetricsInputSchema,
  agentTelemetryInputSchema,
} from "api-server-api";
import type { AgentSpend, AgentSpendQuery } from "api-server-api";
import { createAgentTelemetry } from "../../modules/metrics/index.js";
import type {
  AgentSpendPort,
  MetricsReader,
  MetricsWindow,
} from "../../modules/metrics/index.js";

// TEST_OVERVIEW: The agent-facing reads are how an agent sees its own runs — what they cost, the per-call context, the records it emitted and its span shape. Each must pin the query to exactly the calling agent (the isolation boundary: an agent may never reach another's figures), take its cost figures from the measured spend in UTC days, bound the window and the row count at the schemas the tools parse with, carry a session narrowing through, and degrade to an explicit available=false for the telemetry-backed parts when no telemetry backend is installed.

const counts = {
  calls: 1,
  estimatedCalls: 0,
  uncachedInputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  webSearches: 0,
};

function measuredSpend(extra: Partial<AgentSpend> = {}): AgentSpend {
  return {
    measuredSince: "2026-10-13T00:00:00.000Z",
    scope: "payer",
    totals: [{ unit: "usd", costMicros: 1_500_000, ...counts }],
    byModel: [{ model: "m1", unit: "usd", costMicros: 1_500_000, ...counts }],
    modelTimeMs: 400,
    sessionCount: 2,
    ...extra,
  };
}

function spendPort(answer: AgentSpend = measuredSpend()) {
  const queries: AgentSpendQuery[] = [];
  const port: AgentSpendPort = {
    read: async (query) => {
      queries.push(query);
      return answer;
    },
    callCosts: async () => [],
  };
  return { port, queries };
}

interface Seen {
  ids: string[];
  window: MetricsWindow;
  limit?: number;
}

function reader(
  sessionResolves = true,
  rowsFor: (limit: number) => unknown[] = () => [],
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
    tokenSpendByModel: async () => [],
    tokenSpendByProvider: async () => [],
    runtimeBySession: async () => [],
    contextPerCall: async (ids, window, limit) => {
      note(ids, window, limit);
      return rowsFor(limit) as never;
    },
    telemetryEvents: async (ids, window, limit) => {
      note(ids, window, limit);
      return rowsFor(limit) as never;
    },
    sessionResolves: async (ids, window) => {
      note(ids, window);
      return sessionResolves;
    },
    traceSpans: async (ids, window, limit) => {
      note(ids, window, limit);
      return rowsFor(limit) as never;
    },
    spendByAgent: async () => [],
    spendByDay: async () => [],
    spendBySession: async () => [],
  };
  return { r, seen };
}

describe("agent telemetry", () => {
  /**
   * TEST_SCENARIO: The isolation boundary. Every read must ask with exactly the
   * calling agent's id — widening any one of them would let an agent read its
   * owner's whole fleet through a surface the platform scopes to one agent.
   */
  it("pins every read to the calling agent", async () => {
    const { r, seen } = reader();
    const { port, queries } = spendPort();
    const svc = createAgentTelemetry({ reader: r, spend: port });
    const query = { days: 7, limit: 10 };
    await svc.metrics("agent-a", { ...query, granularity: "summary" });
    await svc.metrics("agent-a", { ...query, granularity: "call" });
    await svc.metrics("agent-a", { ...query, granularity: "subagent" });
    await svc.logs("agent-a", query);
    await svc.spans("agent-a", query);
    expect(queries.map((q) => q.agentId)).toEqual([
      "agent-a",
      "agent-a",
      "agent-a",
    ]);
    expect(
      seen.every((s) => s.ids.length === 1 && s.ids[0] === "agent-a"),
    ).toBe(true);
  });

  // TEST_SCENARIO: The cost figures cover whole UTC days, today and the days before it, so they match the screens and the limits; the result says which days and since when the gateway measures.
  it("measures the window as UTC days and reports it", async () => {
    const { port, queries } = spendPort();
    const svc = createAgentTelemetry({ reader: null, spend: port });
    const result = await svc.metrics("agent-a", {
      days: 7,
      limit: 50,
      granularity: "summary",
    });
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 6 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(queries[0]).toMatchObject({ from, to: today });
    expect(result).toMatchObject({
      available: true,
      windowDays: 7,
      window: { from, to: today },
      measuredSince: "2026-10-13T00:00:00.000Z",
    });
  });

  // TEST_SCENARIO: A session narrowing has to reach both sources: the measured spend narrows its totals to the session, and the telemetry reads narrow their rows; dropping it would silently answer for every session the agent ran.
  it("carries a session narrowing through", async () => {
    const { r, seen } = reader();
    const { port, queries } = spendPort();
    const svc = createAgentTelemetry({ reader: r, spend: port });
    await svc.metrics("agent-a", {
      days: 7,
      limit: 50,
      granularity: "call",
      sessionId: "s-1",
    });
    expect(queries[0]?.sessionId).toBe("s-1");
    expect(seen.every((s) => s.window.sessionId === "s-1")).toBe(true);
    const result = await svc.spans("agent-a", {
      days: 7,
      limit: 5,
      sessionId: "s-1",
    });
    expect(result).toMatchObject({ available: true, sessionId: "s-1" });
  });

  // TEST_SCENARIO: Each figure keeps its own unit, with the amount written out, because one agent can spend dollars, plan use and Bobcoins at once and none of them adds to another.
  it("prices each figure in its own unit", async () => {
    const { port } = spendPort(
      measuredSpend({
        totals: [
          { unit: "usd", costMicros: 1_500_000, ...counts },
          { unit: "bobcoin", costMicros: 250_000, ...counts },
        ],
      }),
    );
    const svc = createAgentTelemetry({ reader: null, spend: port });
    const result = await svc.metrics("agent-a", {
      days: 7,
      limit: 50,
      granularity: "summary",
    });
    expect(
      result.available && result.totals.map((t) => [t.unit, t.amount]),
    ).toEqual([
      ["usd", "$1.50"],
      ["bobcoin", "0.25 Bobcoins"],
    ]);
  });

  // TEST_SCENARIO: The per-session breakdown is the answer to "which conversation cost what": it must reach the caller with its amounts priced and the measured truncation, rather than being collapsed to a count.
  it("reports per-session detail alongside the totals", async () => {
    const { port, queries } = spendPort(
      measuredSpend({
        sessions: {
          rows: [
            {
              sessionId: "s1",
              amounts: [{ unit: "usd", costMicros: 1_000_000 }],
              subAgentAmounts: [{ unit: "usd", costMicros: 250_000 }],
              calls: 3,
              durationMs: 300,
              uncachedInputTokens: 1,
              outputTokens: 1,
              cacheReadTokens: 0,
              cacheWrite5mTokens: 0,
              cacheWrite1hTokens: 0,
              firstDay: "2026-10-14",
              lastDay: "2026-10-15",
            },
          ],
          truncated: true,
        },
      }),
    );
    const svc = createAgentTelemetry({ reader: null, spend: port });
    const result = await svc.metrics("agent-a", {
      days: 7,
      limit: 1,
      granularity: "session",
    });
    expect(queries[0]?.sessionLimit).toBe(1);
    expect(result).toMatchObject({
      available: true,
      sessionCount: 2,
      truncated: true,
    });
    expect(
      result.available &&
        result.sessions?.map((s) => [
          s.sessionId,
          s.amounts[0]?.amount,
          s.subAgentAmounts[0]?.amount,
        ]),
    ).toEqual([["s1", "$1.00", "$0.25"]]);
  });

  /**
   * TEST_SCENARIO: A Driver reads what each sub-agent cost so it can compare
   * models and harnesses. Each row must be keyed by the id spawn_subagent
   * returned, beside the whole-window totals, with the measured truncation.
   */
  it("reports a row per sub-agent keyed by its spawn id", async () => {
    const { port, queries } = spendPort(
      measuredSpend({
        subAgents: {
          rows: [
            {
              agentId: "inv-1",
              models: ["m1"],
              amounts: [{ unit: "usd", costMicros: 2_000_000 }],
              calls: 1,
              durationMs: 100,
              uncachedInputTokens: 10,
              outputTokens: 5,
              cacheReadTokens: 0,
              cacheWrite5mTokens: 0,
              cacheWrite1hTokens: 0,
              firstDay: "2026-10-15",
              lastDay: "2026-10-15",
            },
          ],
          truncated: false,
        },
      }),
    );
    const svc = createAgentTelemetry({ reader: null, spend: port });
    const result = await svc.metrics("agent-a", {
      days: 7,
      limit: 50,
      granularity: "subagent",
    });
    expect(queries[0]?.subAgentLimit).toBe(50);
    expect(result).toMatchObject({ granularity: "subagent", truncated: false });
    expect(
      result.available &&
        result.subAgents?.map((s) => [s.subAgentId, s.amounts[0]?.amount]),
    ).toEqual([["inv-1", "$2.00"]]);
    expect(result.available && result.sessions).toBeUndefined();
  });

  // TEST_SCENARIO: A row cap keeps one tool call from dragging back the whole retained window. The reader is asked for one row past the page on purpose — that extra row is what tells truncation apart from a page that merely came out full — so the bound the store sees is still the caller's, plus exactly one.
  it("asks the reader for one row past the caller's page", async () => {
    const { r, seen } = reader();
    const svc = createAgentTelemetry({ reader: r, spend: spendPort().port });
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
    const { r, seen } = reader();
    const { port, queries } = spendPort();
    const svc = createAgentTelemetry({ reader: r, spend: port });
    const result = await svc.metrics("agent-a", {
      days: 7,
      limit: 50,
      granularity: "summary",
    });
    expect(queries[0]).not.toHaveProperty("sessionLimit");
    expect(queries[0]).not.toHaveProperty("subAgentLimit");
    expect(seen).toHaveLength(0);
    expect(result).toMatchObject({ available: true, sessionCount: 2 });
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
   * TEST_SCENARIO: The truncation flag is the only thing telling an agent
   * whether its rows are the whole answer, so it must never be inferred from
   * the page being full. Each telemetry read asks for one row past the page:
   * a page that exactly fills has dropped nothing, and one row more flags
   * truncation and is trimmed to the page.
   */
  it("flags truncation only when more rows exist than the page", async () => {
    const rows = (n: number) => Array.from({ length: n }, () => ({}));
    const q = { days: 7, limit: 2 };
    const exact = createAgentTelemetry({
      reader: reader(true, (limit) => rows(limit - 1)).r,
      spend: spendPort().port,
    });
    expect(
      await exact.metrics("agent-a", { ...q, granularity: "call" }),
    ).toMatchObject({ truncated: false });
    expect(await exact.logs("agent-a", q)).toMatchObject({ truncated: false });
    expect(await exact.spans("agent-a", q)).toMatchObject({ truncated: false });

    const more = createAgentTelemetry({
      reader: reader(true, (limit) => rows(limit)).r,
      spend: spendPort().port,
    });
    const call = await more.metrics("agent-a", { ...q, granularity: "call" });
    expect(call).toMatchObject({ truncated: true });
    expect(call.available && call.calls).toHaveLength(2);
    const logs = await more.logs("agent-a", q);
    expect(logs).toMatchObject({ truncated: true });
    expect(logs.available && logs.logs).toHaveLength(2);
    const spans = await more.spans("agent-a", q);
    expect(spans).toMatchObject({ truncated: true });
    expect(spans.available && spans.spans).toHaveLength(2);
  });

  /**
   * TEST_SCENARIO: Spans carry no session id, so a narrowed span read resolves
   * the session's trace family from its call records — which a traces-only
   * harness does not have. An unresolvable narrowing must be reported as
   * unresolved: answering an empty list would read as "this session ran
   * nothing", which is a different and wrong claim.
   */
  it("reports an unresolvable span narrowing rather than an empty measurement", async () => {
    const { r, seen } = reader(false);
    const svc = createAgentTelemetry({ reader: r, spend: spendPort().port });
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
    const svc = createAgentTelemetry({ reader: r, spend: spendPort().port });
    const result = await svc.spans("agent-a", { days: 7, limit: 10 });
    expect(result).not.toHaveProperty("sessionUnresolved");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.limit).toBe(11);
  });

  // TEST_SCENARIO: With no telemetry backend the cost still answers from the measured spend, while every telemetry-backed read answers available=false as a result, not a throw — an error reads to a skill as a transient failure and invites retries or estimation.
  it("answers the cost without the telemetry backend", async () => {
    const svc = createAgentTelemetry({ reader: null, spend: spendPort().port });
    const query = { days: 30, limit: 10 };
    const [summary, session, subagent, call, logs, spans] = await Promise.all([
      svc.metrics("agent-a", { ...query, granularity: "summary" }),
      svc.metrics("agent-a", { ...query, granularity: "session" }),
      svc.metrics("agent-a", { ...query, granularity: "subagent" }),
      svc.metrics("agent-a", { ...query, granularity: "call" }),
      svc.logs("agent-a", query),
      svc.spans("agent-a", query),
    ]);
    expect([summary, session, subagent].map((r) => r.available)).toEqual([
      true,
      true,
      true,
    ]);
    expect([call, logs, spans].map((r) => r.available)).toEqual([
      false,
      false,
      false,
    ]);
  });
});
