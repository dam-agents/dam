import { describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  createClickhouseReader,
  MAX_EXECUTION_SECONDS,
} from "../../modules/metrics/infrastructure/clickhouse-reader.js";

function fakeClient(returnRows: Record<string, unknown>[]): {
  client: ClickHouseClient;
  queries: string[];
  settings: unknown[];
} {
  const queries: string[] = [];
  const settings: unknown[] = [];
  const client = {
    query: async ({
      query,
      clickhouse_settings,
    }: {
      query: string;
      clickhouse_settings?: unknown;
    }) => {
      queries.push(query);
      settings.push(clickhouse_settings);
      return { json: async () => returnRows };
    },
  } as unknown as ClickHouseClient;
  return { client, queries, settings };
}

describe("every metrics read is bounded on the server", () => {
  // TEST_SCENARIO: A month's breakdown ran longer than the client waited; the client hung up and ClickHouse kept every abandoned read until its query slots were full. Each read must carry a server-side time limit, and ask ClickHouse to cancel it when the client goes away.
  it("sends max_execution_time and cancel-on-close with each read", async () => {
    const { client, settings } = fakeClient([]);
    const reader = createClickhouseReader(client);
    const window = {
      fromIso: "2026-10-01T00:00:00.000Z",
      toIso: "2026-11-01T00:00:00.000Z",
    };
    await reader.tokenSpendByModel(["a-1"], window);
    await reader.spendBySession(["a-1"], window);
    await reader.runtimeBySession(["a-1"], window);
    await reader.traceSpans(["a-1"], window, 10);
    expect(settings).toHaveLength(4);
    for (const s of settings) {
      expect(s).toEqual({
        max_execution_time: MAX_EXECUTION_SECONDS,
        cancel_http_readonly_queries_on_client_close: 1,
      });
    }
  });
});

const ROOTS_END = "SELECT\n           coalesce";

describe("runtimeBySession folds sessions under their trace root", () => {
  it("resolves each trace's root as the session with the earliest row", async () => {
    const { client, queries } = fakeClient([]);
    await createClickhouseReader(client).runtimeBySession(["a-1"], {
      hours: 24,
    });
    expect(queries).toHaveLength(1);
    const sql = queries[0];
    expect(sql).toContain("argMin(sid, firstAt) AS traceRootSid");
    expect(sql).toContain("argMin(traceRootSid, member.2) AS rootSid");
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
    expect(gates).toHaveLength(
      (queries[0].match(/FROM otel_logs/g) ?? []).length,
    );
  });

  // TEST_SCENARIO: The roots of traces and of sessions both come from the (session, trace) pairs. Reading those pairs once, rather than once per root, keeps a month's read inside the server's time limit.
  it("reads the session and trace pairs once for both roots", async () => {
    const { client, queries } = fakeClient([]);
    await createClickhouseReader(client).spendBySession(["a-1"], {
      fromIso: "2026-10-01T00:00:00.000Z",
    });
    const [roots] = queries[0].split(ROOTS_END);
    expect(roots.match(/GROUP BY sid, TraceId/g)).toHaveLength(1);
    expect(roots).not.toContain("trace_root");
    expect(roots).toContain("ARRAY JOIN members AS member");
  });

  it("computes roots session-unfiltered even when the read is session-scoped", async () => {
    const { client, queries } = fakeClient([]);
    await createClickhouseReader(client).runtimeBySession(["a-1"], {
      sessionId: "s-1",
    });
    const [roots, rest] = queries[0].split(ROOTS_END);
    expect(roots).toContain("session_root AS");
    expect(roots).not.toContain("{sessionId:String}");
    expect(rest).toContain("{sessionId:String}");
  });

  it("narrows a multi-session read to those sessions while roots stay unfiltered", async () => {
    const { client, queries } = fakeClient([]);
    await createClickhouseReader(client).runtimeBySession(["a-1"], {
      fromIso: "2026-10-01T00:00:00.000Z",
      sessionIds: ["s-1", "s-2"],
    });
    const [roots, rest] = queries[0].split(ROOTS_END);
    expect(roots).toContain("session_root AS");
    expect(roots).not.toContain("{sessionIds:Array(String)}");
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
