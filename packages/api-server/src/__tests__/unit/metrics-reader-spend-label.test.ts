import { describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { createClickhouseReader } from "../../modules/metrics/infrastructure/clickhouse-reader.js";

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
    expect(queries[0]).toContain(
      "argMaxIf(agentNameRaw, ts, invocationId = '' AND agentNameRaw != '') AS agentName",
    );
    expect(queries[0]).toContain(
      "ResourceAttributes['platform.agent.id'] AS agentId",
    );
  });

  it("yields an empty agentName for a bucket whose only in-window rows are child rows", async () => {
    const { client } = fakeClient([
      { agentId: "root-driver", agentName: null, costUsd: "1.5" },
    ]);
    const out = await createClickhouseReader(client).spendByAgent(
      ["root-driver"],
      { hours: 24 },
    );
    expect(out).toEqual([
      { agentId: "root-driver", agentName: "", costUsd: 1.5, credits: [] },
    ]);
  });
});
