import { describe, expect, it } from "vitest";
import {
  createDisabledMetricsService,
  createMetricsService,
  type MetricsReader,
  type MetricsWindow,
} from "../../modules/metrics/index.js";

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

const owned = () => Promise.resolve(["agent-a", "agent-b"]);
const query = { sinceHours: 24, limit: 100 };

describe("metrics ownership gate", () => {
  it("scopes to all owned agents when no agentId is given", async () => {
    const { reader, calls } = spyReader();
    const svc = createMetricsService({ reader, listOwnedAgentIds: owned });
    await svc.overview(query);
    expect(calls).toEqual(Array(3).fill(["agent-a", "agent-b"]));
  });

  it("narrows to a single owned agent", async () => {
    const { reader, calls } = spyReader();
    const svc = createMetricsService({ reader, listOwnedAgentIds: owned });
    await svc.overview({ ...query, agentId: "agent-a" });
    expect(calls).toEqual(Array(3).fill(["agent-a"]));
  });

  it("returns nothing and never queries for an unowned agent", async () => {
    const { reader, calls } = spyReader();
    const svc = createMetricsService({ reader, listOwnedAgentIds: owned });
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
    const svc = createMetricsService({ reader, listOwnedAgentIds: owned });
    await svc.overview({ ...query, sessionId: "sess-1" });
    expect(windows).toEqual(Array(3).fill({ hours: 24, sessionId: "sess-1" }));
  });

  it("returns nothing when the caller owns no agents", async () => {
    const { reader, calls } = spyReader();
    const svc = createMetricsService({
      reader,
      listOwnedAgentIds: () => Promise.resolve([]),
    });
    expect((await svc.overview(query)).tokenSpendByModel).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("spendBreakdown resolves ownership once, then scopes all three reads to the owned agents and passes the range through", async () => {
    const { reader, calls, windows } = spyReader();
    let scopeResolutions = 0;
    const svc = createMetricsService({
      reader,
      listOwnedAgentIds: () => {
        scopeResolutions++;
        return owned();
      },
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
      listOwnedAgentIds: owned,
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
      listOwnedAgentIds: () => Promise.resolve([]),
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
