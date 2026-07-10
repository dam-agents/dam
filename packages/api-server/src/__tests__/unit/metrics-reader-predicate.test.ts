import { describe, expect, it } from "vitest";
import { ownedApiRequests } from "../../modules/metrics/infrastructure/clickhouse-reader.js";

// The session-scoped predicate must fold in same-trace records: child harness
// runs (subshell `claude -p`, dam-run) mint fresh session ids but inherit the
// session's TRACEPARENT, so "this session" finds them via TraceId.
describe("ownedApiRequests", () => {
  it("matches the exact session by id", () => {
    const sql = ownedApiRequests({ sessionId: "s-1" });
    expect(sql).toContain("LogAttributes['session.id'] = {sessionId:String}");
  });

  it("folds in whole sessions sharing the session's TraceId", () => {
    const sql = ownedApiRequests({ sessionId: "s-1" });
    // Two-level join: traces of the target session → sessions on those traces.
    expect(sql).toContain(
      "OR LogAttributes['session.id'] IN (\n     SELECT DISTINCT LogAttributes['session.id']",
    );
    expect(sql).toContain("SELECT DISTINCT TraceId FROM otel_logs");
    // Every subquery must keep the ownership gate — never join across owners.
    const gates = sql.match(
      /ResourceAttributes\['platform\.agent\.id'\] IN \{agentIds:Array\(String\)\}/g,
    );
    expect(gates).toHaveLength(3);
  });

  it("applies no session predicate without a sessionId", () => {
    const sql = ownedApiRequests({ hours: 24 });
    expect(sql).not.toContain("sessionId");
    expect(sql).not.toContain("TraceId");
    expect(sql).toContain("toIntervalHour({hours:UInt32})");
  });
});
