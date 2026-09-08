import { describe, expect, it } from "vitest";
import {
  USAGE_SUMMARY_MAX_DAYS,
  usageSummaryInputSchema,
} from "api-server-api";
import type { TokenSpendByModel } from "api-server-api";
import {
  createAgentUsageSummary,
  createUnavailableAgentUsageSummary,
} from "../../modules/metrics/index.js";
import type {
  MetricsReader,
  MetricsWindow,
} from "../../modules/metrics/index.js";

// TEST_OVERVIEW: get_usage_summary is the agent-facing cost read the case-study skill depends on for grounded numbers. It must pin the query to exactly the calling agent, bound the window to the telemetry store's retention at the one schema the tool parses with, and degrade to an explicit available=false instead of an error when the backend is off — the skill turns that into "cost is not measured", never an estimate.

function spend(model: string, costUsd: number): TokenSpendByModel {
  return {
    model,
    calls: 1,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd,
    durationMs: 100,
  };
}

function reader(byModel: TokenSpendByModel[], sessions: number) {
  const calls: { ids: string[]; window: MetricsWindow }[] = [];
  const r: MetricsReader = {
    tokenSpendByModel: async (ids, window) => {
      calls.push({ ids: [...ids], window });
      return byModel;
    },
    runtimeBySession: async (ids, window) => {
      calls.push({ ids: [...ids], window });
      return Array.from({ length: sessions }, (_, i) => ({
        sessionId: `s${i}`,
        agentId: ids[0]!,
        calls: 1,
        totalDurationMs: 1,
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0,
        firstAt: "",
        lastAt: "",
      }));
    },
    spendByAgent: async () => [],
    spendByDay: async () => [],
    spendBySession: async () => [],
    contextPerCall: async () => [],
    close: async () => {},
  };
  return { r, calls };
}

describe("agent usage summary", () => {
  // TEST_SCENARIO: The summary must query with exactly the calling agent's id — widening here would let any agent read its owner's whole fleet spend through a tool scoped by the mesh to one agent.
  it("pins the reader to the calling agent and sums the window", async () => {
    const { r, calls } = reader([spend("m1", 1.5), spend("m2", 0.25)], 3);
    const svc = createAgentUsageSummary({ reader: r });
    const result = await svc.summary("agent-a", 30);
    expect(
      calls.every((c) => c.ids.length === 1 && c.ids[0] === "agent-a"),
    ).toBe(true);
    expect(result).toMatchObject({
      available: true,
      windowDays: 30,
      totalCostUsd: 1.75,
      sessionCount: 3,
    });
  });

  /**
   * TEST_SCENARIO: The telemetry store retains a bounded window, so a longer
   * request must never imply a longer measurement than exists. The input schema
   * is the single owner of that bound — it is what the agent-facing tool parses
   * with — so the rejection has to happen there, before the reader is asked for
   * a window it cannot answer for.
   */
  it("refuses a window longer than the retained one", () => {
    expect(
      usageSummaryInputSchema.safeParse({ days: USAGE_SUMMARY_MAX_DAYS + 1 })
        .success,
    ).toBe(false);
    expect(
      usageSummaryInputSchema.safeParse({ days: USAGE_SUMMARY_MAX_DAYS })
        .success,
    ).toBe(true);
  });

  // TEST_SCENARIO: The window the service reports must be the one it measured, so a caller can tell which period a cost figure covers.
  it("measures and reports the window it was given", async () => {
    const { r, calls } = reader([], 0);
    const svc = createAgentUsageSummary({ reader: r });
    const result = await svc.summary("agent-a", USAGE_SUMMARY_MAX_DAYS);
    expect(result).toMatchObject({
      available: true,
      windowDays: USAGE_SUMMARY_MAX_DAYS,
    });
    expect(calls[0]?.window).toEqual({ hours: USAGE_SUMMARY_MAX_DAYS * 24 });
  });

  // TEST_SCENARIO: With no telemetry backend the tool must answer available=false as a result, not throw — an error here reads to the skill as a transient failure and invites retries or estimation.
  it("reports unavailable when the backend is off", async () => {
    const svc = createUnavailableAgentUsageSummary();
    const result = await svc.summary("agent-a", 30);
    expect(result.available).toBe(false);
  });
});
