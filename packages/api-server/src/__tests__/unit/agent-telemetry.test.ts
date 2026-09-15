import { describe, expect, it } from "vitest";
import {
  AGENT_TELEMETRY_MAX_DAYS,
  AGENT_TELEMETRY_MAX_LIMIT,
  agentTelemetryRecordsInputSchema,
  usageSummaryInputSchema,
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
    await svc.summary("agent-a", query);
    await svc.llmCalls("agent-a", query);
    await svc.telemetryEvents("agent-a", query);
    await svc.traceSpans("agent-a", query);
    expect(seen.length).toBeGreaterThan(4);
    expect(
      seen.every((s) => s.ids.length === 1 && s.ids[0] === "agent-a"),
    ).toBe(true);
  });

  // TEST_SCENARIO: The per-session breakdown is the answer to "why was that run slow" — it must reach the caller rather than being collapsed to a count, and the totals must agree with the rows they summarize.
  it("reports per-session detail alongside the totals", async () => {
    const { r } = reader(
      [spend("m1", 1.5, 400), spend("m2", 0.25, 100)],
      [session("s1", 300), session("s2", 200)],
    );
    const svc = createAgentTelemetry({ reader: r });
    const result = await svc.summary("agent-a", { days: 7 });
    expect(result).toMatchObject({
      available: true,
      totalCostUsd: 1.75,
      totalDurationMs: 500,
      sessionCount: 2,
    });
    expect(
      result.available && result.bySession.map((s) => s.sessionId),
    ).toEqual(["s1", "s2"]);
  });

  // TEST_SCENARIO: A session narrowing has to reach the reader, since that is where the trace-aware fold lives; dropping it here would silently answer for every session the agent ran.
  it("carries a session narrowing through to the reader", async () => {
    const { r, seen } = reader();
    const svc = createAgentTelemetry({ reader: r });
    await svc.summary("agent-a", { days: 7, sessionId: "s-1" });
    expect(seen.every((s) => s.window.sessionId === "s-1")).toBe(true);
    const result = await svc.traceSpans("agent-a", {
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
    const result = await svc.summary("agent-a", {
      days: AGENT_TELEMETRY_MAX_DAYS,
    });
    expect(result).toMatchObject({
      available: true,
      windowDays: AGENT_TELEMETRY_MAX_DAYS,
    });
    expect(seen[0]?.window).toEqual({ hours: AGENT_TELEMETRY_MAX_DAYS * 24 });
  });

  // TEST_SCENARIO: A row cap keeps one tool call from dragging back the whole retained window; the service must pass the caller's limit rather than a limit of its own.
  it("passes the row limit to the record reads", async () => {
    const { r, seen } = reader();
    const svc = createAgentTelemetry({ reader: r });
    await svc.llmCalls("agent-a", { days: 7, limit: 3 });
    await svc.telemetryEvents("agent-a", { days: 7, limit: 3 });
    await svc.traceSpans("agent-a", { days: 7, limit: 3 });
    expect(seen.map((s) => s.limit)).toEqual([3, 3, 3]);
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
      usageSummaryInputSchema.safeParse({ days: AGENT_TELEMETRY_MAX_DAYS + 1 })
        .success,
    ).toBe(false);
    expect(
      usageSummaryInputSchema.safeParse({ days: AGENT_TELEMETRY_MAX_DAYS })
        .success,
    ).toBe(true);
    expect(
      agentTelemetryRecordsInputSchema.safeParse({
        limit: AGENT_TELEMETRY_MAX_LIMIT + 1,
      }).success,
    ).toBe(false);
    expect(
      agentTelemetryRecordsInputSchema.safeParse({
        limit: AGENT_TELEMETRY_MAX_LIMIT,
      }).success,
    ).toBe(true);
  });

  // TEST_SCENARIO: An agent that names no window gets the cheap one, so an omitted argument cannot cost a full-retention scan.
  it("defaults to the cheap window and page", () => {
    const parsed = agentTelemetryRecordsInputSchema.parse({});
    expect(parsed.days).toBeLessThan(AGENT_TELEMETRY_MAX_DAYS);
    expect(parsed.limit).toBeLessThan(AGENT_TELEMETRY_MAX_LIMIT);
    expect(parsed.sessionId).toBeUndefined();
  });

  // TEST_SCENARIO: With no telemetry backend every read must answer available=false as a result, not throw — an error reads to a skill as a transient failure and invites retries or estimation.
  it("reports unavailable on every read when the backend is off", async () => {
    const svc = createUnavailableAgentTelemetry();
    const query = { days: 30, limit: 10 };
    const results = await Promise.all([
      svc.summary("agent-a", query),
      svc.llmCalls("agent-a", query),
      svc.telemetryEvents("agent-a", query),
      svc.traceSpans("agent-a", query),
    ]);
    expect(results.every((x) => x.available === false)).toBe(true);
  });
});
