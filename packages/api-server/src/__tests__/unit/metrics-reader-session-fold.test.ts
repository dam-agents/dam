import { describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { createClickhouseReader } from "../../modules/metrics/infrastructure/clickhouse-reader.js";

// `runtimeBySession` groups each session under the root session of its trace
// family. The fake client captures the emitted SQL to pin the fold's shape.

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
    // Main read + trace_root + session_root.
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
});
