import { describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { createClickhouseReader } from "../../modules/metrics/infrastructure/clickhouse-reader.js";

// `runtimeBySession` must attribute child harness runs (subshell `claude -p`,
// dam-run executors) to the session that spawned them: each session groups
// under the ROOT session of its trace family instead of its own minted id.
// No live ClickHouse here — the fake client captures the emitted SQL so the
// fold's shape (root resolution, ownership gating, own-id fallback) is pinned
// against regression.

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
    // Root of a trace = earliest session on it (the parent's turn calls the
    // LLM before any child it spawns exists).
    expect(sql).toContain(
      "argMin(LogAttributes['session.id'], Timestamp) AS rootSid",
    );
    // Grouping keys off the root, falling back to the session's own id when
    // it has no traced rows (LEFT JOIN miss).
    expect(sql).toContain("coalesce(nullIf(rootSid, ''), sid) AS sessionId");
    expect(sql).toContain("LEFT JOIN session_root USING (sid)");
  });

  it("keeps every fold subquery gated on the owner allowlist", async () => {
    const { client, queries } = fakeClient([]);
    await createClickhouseReader(client).runtimeBySession(["a-1"], {
      hours: 24,
    });
    // Main read + trace_root + session_root — the fold never reaches across
    // owners, mirroring the session-filter fold's guarantee.
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
    // A session's root doesn't depend on which session the caller is looking
    // at: the CTEs must not carry the session predicate. Only the main read's
    // WHERE folds in the target's trace family (its own nested subqueries).
    const [traceRootCte] = sql.split("session_root AS");
    expect(traceRootCte).not.toContain("{sessionId:String}");
  });
});
