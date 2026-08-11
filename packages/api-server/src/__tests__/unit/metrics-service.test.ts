import { describe, expect, it } from "vitest";
import {
  createDisabledMetricsService,
  createMetricsService,
  type MetricsReader,
  type MetricsWindow,
} from "../../modules/metrics/index.js";
import { isInvocationTargetName } from "../../modules/invocations/index.js";

// Records the agent-id allowlist and window each reader method is called with,
// so we can assert the ownership gate resolved the right scope before touching
// ClickHouse.
function spyReader(): {
  reader: MetricsReader;
  calls: string[][];
  windows: MetricsWindow[];
} {
  const calls: string[][] = [];
  const windows: MetricsWindow[] = [];
  const record = async (agentIds: readonly string[], window: MetricsWindow) => {
    calls.push([...agentIds]);
    windows.push(window);
    return [];
  };
  return {
    calls,
    windows,
    reader: {
      tokenSpendByModel: (ids, w) => record(ids, w),
      spendByAgent: (ids, w) => record(ids, w),
      spendByDay: (ids, w) => record(ids, w),
      runtimeBySession: (ids, w) => record(ids, w),
      contextPerCall: (ids, w) => record(ids, w),
      close: async () => {},
    },
  };
}

const owned = () =>
  Promise.resolve([
    { id: "agent-a", name: "alpha" },
    { id: "agent-b", name: null },
  ]);
const neverTarget = (_name: string) => false;
const query = { sinceHours: 24, limit: 100 };

describe("metrics ownership gate", () => {
  it("scopes to all owned agents when no agentId is given", async () => {
    const { reader, calls } = spyReader();
    const svc = createMetricsService({
      reader,
      listOwnedAgents: owned,
      isInvocationTargetName: neverTarget,
    });
    await svc.overview(query);
    expect(calls).toEqual(Array(3).fill(["agent-a", "agent-b"]));
  });

  it("narrows to a single owned agent", async () => {
    const { reader, calls } = spyReader();
    const svc = createMetricsService({
      reader,
      listOwnedAgents: owned,
      isInvocationTargetName: neverTarget,
    });
    await svc.overview({ ...query, agentId: "agent-a" });
    expect(calls).toEqual(Array(3).fill(["agent-a"]));
  });

  it("returns nothing and never queries for an unowned agent", async () => {
    const { reader, calls } = spyReader();
    const svc = createMetricsService({
      reader,
      listOwnedAgents: owned,
      isInvocationTargetName: neverTarget,
    });
    const overview = await svc.overview({
      ...query,
      agentId: "agent-someone-else",
    });
    expect(overview).toEqual({
      tokenSpendByModel: [],
      runtimeBySession: [],
      contextPerCall: [],
    });
    expect(calls).toEqual([]); // ClickHouse never touched — the ownership guarantee
  });

  it("passes the session filter through to every reader query", async () => {
    const { reader, windows } = spyReader();
    const svc = createMetricsService({
      reader,
      listOwnedAgents: owned,
      isInvocationTargetName: neverTarget,
    });
    await svc.overview({ ...query, sessionId: "sess-1" });
    expect(windows).toEqual(Array(3).fill({ hours: 24, sessionId: "sess-1" }));
  });

  it("returns nothing when the caller owns no agents", async () => {
    const { reader, calls } = spyReader();
    const svc = createMetricsService({
      reader,
      listOwnedAgents: () => Promise.resolve([]),
      isInvocationTargetName: neverTarget,
    });
    expect((await svc.overview(query)).tokenSpendByModel).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("spendBreakdown resolves ownership once, then scopes all three reads to the owned agents and passes the range through", async () => {
    const { reader, calls, windows } = spyReader();
    let scopeResolutions = 0;
    const svc = createMetricsService({
      reader,
      listOwnedAgents: () => {
        scopeResolutions++;
        return owned();
      },
      isInvocationTargetName: neverTarget,
    });
    await svc.spendBreakdown({
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
      timeZone: "America/New_York",
    });
    // One ownership resolution for the whole tab, not three.
    expect(scopeResolutions).toBe(1);
    // The three rollups (byModel, byAgent, byDay) all run under that scope.
    expect(calls).toEqual(Array(3).fill(["agent-a", "agent-b"]));
    expect(windows).toEqual(
      Array(3).fill({
        fromIso: "2026-07-01T00:00:00.000Z",
        toIso: "2026-08-01T00:00:00.000Z",
      }),
    );
  });

  it("spendBreakdown narrows to a single owned agent", async () => {
    const { reader, calls } = spyReader();
    const svc = createMetricsService({
      reader,
      listOwnedAgents: owned,
      isInvocationTargetName: neverTarget,
    });
    await svc.spendBreakdown({
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
      timeZone: "Europe/Prague",
      agentId: "agent-a",
    });
    expect(calls).toEqual(Array(3).fill(["agent-a"]));
  });

  it("spendBreakdown forwards the timezone to the per-day reader", async () => {
    const zones: string[] = [];
    const svc = createMetricsService({
      reader: {
        tokenSpendByModel: async () => [],
        spendByAgent: async () => [],
        spendByDay: async (_ids, _w, tz) => {
          zones.push(tz);
          return [];
        },
        runtimeBySession: async () => [],
        contextPerCall: async () => [],
        close: async () => {},
      },
      listOwnedAgents: owned,
      isInvocationTargetName: neverTarget,
    });
    await svc.spendBreakdown({
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
      timeZone: "Europe/Prague",
    });
    expect(zones).toEqual(["Europe/Prague"]);
  });

  it("spendBreakdown returns empty rollups and never queries when the caller owns no agents", async () => {
    const { reader, calls } = spyReader();
    const svc = createMetricsService({
      reader,
      listOwnedAgents: () => Promise.resolve([]),
      isInvocationTargetName: neverTarget,
    });
    expect(
      await svc.spendBreakdown({
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-08-01T00:00:00.000Z",
        timeZone: "America/New_York",
      }),
    ).toEqual({ byModel: [], byAgent: [], byDay: [] });
    expect(calls).toEqual([]);
  });

  it("disabled service fails closed", async () => {
    const svc = createDisabledMetricsService();
    await expect(svc.overview(query)).rejects.toThrow(/not enabled/);
    await expect(
      svc.spendBreakdown({
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-08-01T00:00:00.000Z",
        timeZone: "America/New_York",
      }),
    ).rejects.toThrow(/not enabled/);
  });
});

// The per-agent spend rollup must never surface an Invocation target as a
// spend principal: live agents are relabelled from the platform registry, and
// buckets still carrying a minted `invocation-<hex>` name after that overlay
// (pre-attribution-cutover targets whose driver is unrecoverable) are dropped
// from byAgent while byModel/byDay keep counting their spend.
describe("spendBreakdown per-agent labels", () => {
  const breakdownQuery = {
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-08-01T00:00:00.000Z",
    timeZone: "Europe/Prague",
  };

  function readerWithByAgent(
    rows: { agentId: string; agentName: string; costUsd: number }[],
  ): MetricsReader {
    return {
      tokenSpendByModel: async () => [],
      spendByAgent: async () => rows,
      spendByDay: async () => [],
      runtimeBySession: async () => [],
      contextPerCall: async () => [],
      close: async () => {},
    };
  }

  it("labels a live agent from the registry even when its telemetry name is a target's", async () => {
    // A driver whose in-window rows are all delegated child rows can end up
    // with a target-polluted (or empty) telemetry name; the registry name wins.
    const svc = createMetricsService({
      reader: readerWithByAgent([
        {
          agentId: "driver-1",
          agentName: "invocation-7445bdaa11ff",
          costUsd: 202.48,
        },
        { agentId: "driver-2", agentName: "", costUsd: 3.5 },
      ]),
      listOwnedAgents: () =>
        Promise.resolve([
          { id: "driver-1", name: "stellar-sparrow" },
          { id: "driver-2", name: "quiet-heron" },
        ]),
      isInvocationTargetName,
    });
    const out = await svc.spendBreakdown(breakdownQuery);
    expect(out.byAgent).toEqual([
      { agentId: "driver-1", agentName: "stellar-sparrow", costUsd: 202.48 },
      { agentId: "driver-2", agentName: "quiet-heron", costUsd: 3.5 },
    ]);
  });

  it("drops a deleted target's own bucket instead of showing its throwaway name", async () => {
    const svc = createMetricsService({
      reader: readerWithByAgent([
        {
          agentId: "agent-gone",
          agentName: "invocation-7445bdaa11ff",
          costUsd: 202.48,
        },
        { agentId: "agent-live", agentName: "stellar-sparrow", costUsd: 0.04 },
      ]),
      listOwnedAgents: () =>
        Promise.resolve([
          { id: "agent-gone", name: null },
          { id: "agent-live", name: "stellar-sparrow" },
        ]),
      isInvocationTargetName,
    });
    const out = await svc.spendBreakdown(breakdownQuery);
    expect(out.byAgent).toEqual([
      { agentId: "agent-live", agentName: "stellar-sparrow", costUsd: 0.04 },
    ]);
  });

  it("keeps a live agent the user literally named like a target", async () => {
    // The target guard keys on "no live agent", not on the name alone — a
    // user can create an agent called `invocation-<hex>`, and its spend must
    // not vanish from the chart while still counting in the total.
    const svc = createMetricsService({
      reader: readerWithByAgent([
        {
          agentId: "agent-odd",
          agentName: "invocation-7445bdaa11ff",
          costUsd: 7,
        },
      ]),
      listOwnedAgents: () =>
        Promise.resolve([{ id: "agent-odd", name: "invocation-7445bdaa11ff" }]),
      isInvocationTargetName,
    });
    const out = await svc.spendBreakdown(breakdownQuery);
    expect(out.byAgent).toEqual([
      {
        agentId: "agent-odd",
        agentName: "invocation-7445bdaa11ff",
        costUsd: 7,
      },
    ]);
  });

  it("keeps a deleted non-target agent under its last telemetry-known name", async () => {
    const svc = createMetricsService({
      reader: readerWithByAgent([
        { agentId: "agent-gone", agentName: "old-friend", costUsd: 12 },
      ]),
      listOwnedAgents: () =>
        Promise.resolve([{ id: "agent-gone", name: null }]),
      isInvocationTargetName,
    });
    const out = await svc.spendBreakdown(breakdownQuery);
    expect(out.byAgent).toEqual([
      { agentId: "agent-gone", agentName: "old-friend", costUsd: 12 },
    ]);
  });
});
