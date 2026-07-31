import { describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { createClickhouseReader } from "../../modules/metrics/infrastructure/clickhouse-reader.js";

// Slice 03: the per-agent spend label must be read from the agent's OWN rows.
// A row attributed to a root Driver but carrying a `platform.invocation.id`
// belongs to a short-lived target whose name (`invocation-<hex>`) must never
// become the Driver's bar label. `spendByAgent` enforces this with an
// `argMaxIf` that only considers rows where `platform.invocation.id` is empty.
// No live ClickHouse here, so the fake client captures the emitted SQL and
// returns the row shape ClickHouse produces, letting us pin both halves of the
// contract against regression.

function fakeClient(returnRows: Record<string, unknown>[]): {
  client: ClickHouseClient;
  queries: string[];
} {
  const queries: string[] = [];
  const client = {
    query: async ({ query }: { query: string }) => {
      queries.push(query);
      return { json: async () => returnRows };
    },
  } as unknown as ClickHouseClient;
  return { client, queries };
}

describe("spendByAgent labels the bar from the agent's own rows", () => {
  it("guards the argMax name with the empty-invocation-id predicate", async () => {
    const { client, queries } = fakeClient([]);
    await createClickhouseReader(client).spendByAgent(["a-1"], { hours: 24 });
    expect(queries).toHaveLength(1);
    // The name column must exclude child (target) rows.
    expect(queries[0]).toContain(
      "argMaxIf(ResourceAttributes['platform.agent.name'], Timestamp, ResourceAttributes['platform.invocation.id'] = '') AS agentName",
    );
    // …while still keying on the trusted, gateway-stamped agent id.
    expect(queries[0]).toContain(
      "ResourceAttributes['platform.agent.id'] AS agentId",
    );
  });

  it("yields an empty agentName for a bucket whose only in-window rows are child rows", async () => {
    // When every in-window row for a bucket carries a `platform.invocation.id`,
    // the `argMaxIf` condition matches nothing and ClickHouse returns NULL for
    // the name (JSONEachRow renders it as null). The reader must surface that
    // as an empty label, not the target's name and not a crash.
    // `costUsd` is already summed post-division (cost_usd_micros / 1e6) in SQL,
    // so ClickHouse hands back the dollar figure; the reader only re-coerces it.
    const { client } = fakeClient([
      { agentId: "root-driver", agentName: null, costUsd: "1.5" },
    ]);
    const out = await createClickhouseReader(client).spendByAgent(
      ["root-driver"],
      { hours: 24 },
    );
    expect(out).toEqual([
      { agentId: "root-driver", agentName: "", costUsd: 1.5 },
    ]);
  });
});
