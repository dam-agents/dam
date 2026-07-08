import { describe, expect, it } from "vitest";
import {
  createDisabledTelemetryService,
  createTelemetryService,
  type TelemetryReader,
} from "../../modules/telemetry/index.js";

// Records the agent-id allowlist each reader method is called with, so we can
// assert the ownership gate resolved the right scope before touching ClickHouse.
function spyReader(): { reader: TelemetryReader; calls: string[][] } {
  const calls: string[][] = [];
  const record = async (agentIds: readonly string[]) => {
    calls.push([...agentIds]);
    return [];
  };
  return {
    calls,
    reader: {
      tokenSpendByModel: (ids) => record(ids),
      runtimeBySession: (ids) => record(ids),
      contextPerCall: (ids) => record(ids),
      close: async () => {},
    },
  };
}

const owned = () => Promise.resolve(["agent-a", "agent-b"]);
const query = { sinceHours: 24, limit: 100 };

describe("telemetry ownership gate", () => {
  it("scopes to all owned agents when no agentId is given", async () => {
    const { reader, calls } = spyReader();
    const svc = createTelemetryService({ reader, listOwnedAgentIds: owned });
    await svc.overview(query);
    expect(calls).toEqual(Array(3).fill(["agent-a", "agent-b"]));
  });

  it("narrows to a single owned agent", async () => {
    const { reader, calls } = spyReader();
    const svc = createTelemetryService({ reader, listOwnedAgentIds: owned });
    await svc.overview({ ...query, agentId: "agent-a" });
    expect(calls).toEqual(Array(3).fill(["agent-a"]));
  });

  it("returns nothing and never queries for an unowned agent", async () => {
    const { reader, calls } = spyReader();
    const svc = createTelemetryService({ reader, listOwnedAgentIds: owned });
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

  it("returns nothing when the caller owns no agents", async () => {
    const { reader, calls } = spyReader();
    const svc = createTelemetryService({
      reader,
      listOwnedAgentIds: () => Promise.resolve([]),
    });
    expect((await svc.overview(query)).tokenSpendByModel).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("disabled service fails closed", async () => {
    const svc = createDisabledTelemetryService();
    await expect(svc.overview(query)).rejects.toThrow(/not enabled/);
  });
});
