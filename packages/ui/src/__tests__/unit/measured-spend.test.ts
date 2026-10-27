import {
  spendAtWindowSchema,
  type SpendBreakdown,
  spendDailyInputSchema,
} from "api-server-api";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.TZ = "America/Los_Angeles";
  return {
    read: vi.fn((input: unknown) => ({ queryKey: ["spend", input] })),
    options: undefined as { select?: unknown } | undefined,
  };
});
vi.mock("react", () => ({
  useEffect: () => {},
  useState: (value: unknown) => [value, () => {}],
}));
vi.mock("@tanstack/react-query", () => ({
  skipToken: Symbol("skip"),
  useQuery: (options: { select?: unknown }) => {
    h.options = options;
    return {};
  },
}));
vi.mock("../../trpc.js", () => ({
  trpc: { spend: { breakdown: { queryOptions: h.read } } },
}));

import { spendRange } from "../../modules/home/lib/spend-period.js";
import { useSpendBreakdown } from "../../modules/metrics/api/queries.js";
import { legacySpendBreakdown } from "../../modules/metrics/lib/measured-spend.js";
import {
  fillMonthDays,
  monthLabel,
  monthRange,
  monthStart,
} from "../../modules/metrics/lib/month-range.js";

const counts = {
  calls: 2,
  estimatedCalls: 0,
  uncachedInputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 1000,
  cacheWrite5mTokens: 10,
  cacheWrite1hTokens: 5,
  webSearches: 0,
};

const measured: SpendBreakdown = {
  from: "2026-10-27",
  to: "2026-10-27",
  totals: [],
  byDay: [
    { day: "2026-10-27", unit: "usd", costMicros: 300_000 },
    { day: "2026-10-27", unit: "usd_list", costMicros: 900_000 },
  ],
  byAgent: [
    {
      agentId: "a-pi",
      agentName: "qa-pi",
      calls: 2,
      unit: "usd",
      costMicros: 100_000,
    },
    {
      agentId: "a-cl",
      agentName: null,
      calls: 2,
      unit: "usd",
      costMicros: 200_000,
    },
    {
      agentId: "a-pi",
      agentName: "qa-pi",
      calls: 1,
      unit: "bobcoin",
      costMicros: 5_000_000,
    },
  ],
  byModel: [
    {
      model: "ibm/aws/claude-opus-5-5",
      unit: "usd",
      costMicros: 300_000,
      ...counts,
    },
    {
      model: "ibm/aws/claude-opus-5-5",
      unit: "usd_list",
      costMicros: 900_000,
      ...counts,
    },
  ],
  byConnection: [],
  modelTimeMs: 4200,
  bySessionType: [
    { category: "chats", unit: "usd", costMicros: 250_000 },
    { category: "subagents", unit: "usd", costMicros: 30_000 },
    { category: "none", unit: "usd", costMicros: 20_000 },
  ],
  byCallingAgent: [],
  otherSubAgents: { count: 0, amounts: [] },
};

afterEach(() => {
  vi.useRealTimers();
});

describe("the restored spend screens read measured spend", () => {
  // TEST_SCENARIO: a routed model's harness reports a zero cost, so Home and Usage read the gateway's measured spend instead of the harness telemetry. The query must go to spend.breakdown, scoped to the agent when one is given.
  it("queries the gateway's measured spend, scoped to the agent", () => {
    useSpendBreakdown({ from: "2026-10-01", to: "2026-10-31" }, "a-pi");
    expect(h.read).toHaveBeenCalledWith({
      from: "2026-10-01",
      to: "2026-10-31",
      agentId: "a-pi",
    });
    expect(h.options?.select).toBe(legacySpendBreakdown);
  });

  // TEST_SCENARIO: one model's paid and subscription-covered rows become one bar: its dollars are the paid calls only, as the release counts spend, and its calls and tokens are all of them.
  it("folds a model's units into one row of paid dollars", () => {
    expect(legacySpendBreakdown(measured).byModel).toEqual([
      {
        model: "ibm/aws/claude-opus-5-5",
        calls: 4,
        uncountedCalls: 0,
        inputTokens: 200,
        outputTokens: 40,
        cacheReadTokens: 2000,
        cacheCreationTokens: 30,
        costUsd: 0.3,
        durationMs: 0,
      },
    ]);
  });

  // TEST_SCENARIO: the top spenders list ranks agents by paid dollars and names an agent the ledger has no name for by its id; Bobcoins are not dollars.
  it("ranks agents by paid dollars", () => {
    expect(legacySpendBreakdown(measured).byAgent).toEqual([
      { agentId: "a-cl", agentName: "a-cl", costUsd: 0.2 },
      { agentId: "a-pi", agentName: "qa-pi", costUsd: 0.1 },
    ]);
  });

  // TEST_SCENARIO: the day chart and the old session types read the same paid dollars; the release's sub-agent and no-session buckets fall into the old "unknown" type, and the agent section's model time is the ledger's.
  it("keeps days, session types and model time", () => {
    const legacy = legacySpendBreakdown(measured);
    expect(legacy.byDay).toEqual([{ day: "2026-10-27", costUsd: 0.3 }]);
    expect(legacy.bySessionType).toEqual([
      { category: "chats", costUsd: 0.25 },
      { category: "unknown", costUsd: 0.05 },
    ]);
    expect(legacy.modelTimeMs).toBe(4200);
  });

  // TEST_SCENARIO: a month is read as UTC days, the ledger's unit, so a month from before the measuring start reads empty rather than an instant window the server widens to the start day.
  it("reads a month as its UTC days", () => {
    const range = monthRange(new Date(Date.UTC(2026, 1, 1)));
    expect(range).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(spendDailyInputSchema.safeParse(range).success).toBe(true);
  });

  // TEST_SCENARIO: in a browser west of UTC just after UTC midnight, the ledger already keys today's calls under the new UTC day. The chart must show that day, so its bars add up to the total above it.
  it("charts today's UTC day in a browser west of UTC", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T00:30:00Z"));
    const days = fillMonthDays(monthStart(new Date(), 0), true, [
      { day: "2026-10-27", costUsd: 0.3 },
    ]);
    expect(days[days.length - 1]).toEqual({ day: "2026-10-27", costUsd: 0.3 });
  });

  // TEST_SCENARIO: across a UTC month boundary the current month is the UTC one, labelled as such, so its spend is reachable while the local calendar still shows the old month.
  it("starts the month at the UTC boundary", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T03:00:00Z"));
    const month = monthStart(new Date(), 0);
    expect(monthRange(month)).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
      isCurrentMonth: true,
    });
    expect(monthLabel(month)).toContain("November");
  });

  // TEST_SCENARIO: Home's periods stay the 0.2.23 rolling windows, sent as an exact window; the year window fits the ledger's 366-day cap.
  it("reads a Home period as an exact window", () => {
    const now = new Date("2026-10-27T07:00:00Z");
    expect(spendRange("1d", now).at).toEqual({
      fromAt: "2026-10-26T07:00:00.000Z",
      toAt: "2026-10-27T07:00:00.000Z",
    });
    expect(
      spendAtWindowSchema.safeParse(spendRange("1y", now).at).success,
    ).toBe(true);
  });
});
