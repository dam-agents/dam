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

describe("runtimeBySession folds sessions under their trace root", () => {
  it("resolves each trace's root as the session with the earliest row", async () => {
    const { client, queries } = fakeClient([]);
    await createClickhouseReader(client).runtimeBySession(["a-1"], {
      hours: 24,
    });
    expect(queries).toHaveLength(1);
    const sql = queries[0];
    expect(sql).toContain(
      "argMin(LogAttributes['session.id'], Timestamp) AS rootSid",
    );
    expect(sql).toContain("coalesce(nullIf(rootSid, ''), sid) AS sessionId");
    expect(sql).toContain("LEFT JOIN session_root USING (sid)");
  });

  it("keeps every fold subquery gated on the owner allowlist", async () => {
    const { client, queries } = fakeClient([]);
    await createClickhouseReader(client).runtimeBySession(["a-1"], {
      hours: 24,
    });
    const gates = queries[0].match(
      /ResourceAttributes\['platform\.agent\.id'\] IN \{agentIds:Array\(String\)\}/g,
    );
    expect(gates).toHaveLength(3);
  });

  it("computes roots session-unfiltered even when the read is session-scoped", async () => {
    const { client, queries } = fakeClient([]);
    await createClickhouseReader(client).runtimeBySession(["a-1"], {
      sessionId: "s-1",
    });
    const sql = queries[0];
    const [traceRootCte] = sql.split("session_root AS");
    expect(traceRootCte).not.toContain("{sessionId:String}");
  });

  it("narrows a multi-session read to those sessions while roots stay unfiltered", async () => {
    const { client, queries } = fakeClient([]);
    await createClickhouseReader(client).runtimeBySession(["a-1"], {
      fromIso: "2026-10-01T00:00:00.000Z",
      sessionIds: ["s-1", "s-2"],
    });
    const [traceRootCte, rest] = queries[0].split("session_root AS");
    expect(traceRootCte).not.toContain("{sessionIds:Array(String)}");
    expect(rest).toContain(
      "LogAttributes['session.id'] IN {sessionIds:Array(String)}",
    );
  });
});

describe("spendByAgent labels the bar from the agent's own rows", () => {
  it("guards the argMax name with the empty-invocation-id predicate", async () => {
    const { client, queries } = fakeClient([]);
    await createClickhouseReader(client).spendByAgent(["a-1"], { hours: 24 });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain(
      "argMaxIf(ResourceAttributes['platform.agent.name'], Timestamp, ResourceAttributes['platform.invocation.id'] = '') AS agentName",
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
      { agentId: "root-driver", agentName: "", costUsd: 1.5 },
    ]);
  });
});

describe("spendBySubAgent groups a Driver's spend by sub-agent", () => {
  // TEST_SCENARIO: The sub-agent rows must stay behind the same owner gate as every other read, so a Driver only ever sees sub-agents whose rows carry its own gateway-stamped id; and they must leave out the Driver's own calls, which carry no invocation id.
  it("gates on the owner allowlist and keeps only sub-agent rows", async () => {
    const { client, queries } = fakeClient([]);
    await createClickhouseReader(client).spendBySubAgent(
      ["driver-a"],
      { hours: 24 },
      11,
    );
    expect(queries).toHaveLength(1);
    const sql = queries[0];
    expect(sql).toContain(
      "ResourceAttributes['platform.agent.id'] IN {agentIds:Array(String)}",
    );
    expect(sql).toContain("ResourceAttributes['platform.invocation.id'] != ''");
    expect(sql).toContain("GROUP BY subAgentId");
    expect(sql).toContain("LIMIT {limit:UInt32}");
  });

  // TEST_SCENARIO: The store answers numbers as strings and the model list unordered, with an empty name for a call that reported no model. The row must carry numbers and a stable list of real model names, so a Driver comparing models reads them as they are.
  it("maps a store row to dollars and a sorted model list", async () => {
    const { client } = fakeClient([
      {
        subAgentId: "inv-1",
        models: ["sonnet", "", "haiku"],
        calls: "3",
        totalDurationMs: "1200",
        inputTokens: "10",
        outputTokens: "5",
        cacheReadTokens: "0",
        cacheCreationTokens: "0",
        costUsd: "0.42",
        firstAt: "2026-10-01 00:00:00",
        lastAt: "2026-10-01 00:05:00",
      },
    ]);
    const out = await createClickhouseReader(client).spendBySubAgent(
      ["driver-a"],
      { hours: 24 },
      11,
    );
    expect(out).toEqual([
      {
        subAgentId: "inv-1",
        models: ["haiku", "sonnet"],
        calls: 3,
        totalDurationMs: 1200,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0.42,
        firstAt: "2026-10-01 00:00:00",
        lastAt: "2026-10-01 00:05:00",
      },
    ]);
  });
});
