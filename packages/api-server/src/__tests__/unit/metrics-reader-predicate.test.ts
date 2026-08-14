import { describe, expect, it } from "vitest";
import { ownedApiRequests } from "../../modules/metrics/infrastructure/clickhouse-reader.js";

describe("ownedApiRequests", () => {
  it("matches the exact session by id", () => {
    const sql = ownedApiRequests({ sessionId: "s-1" });
    expect(sql).toContain("LogAttributes['session.id'] = {sessionId:String}");
  });

  it("folds in whole sessions sharing the session's TraceId", () => {
    const sql = ownedApiRequests({ sessionId: "s-1" });
    expect(sql).toContain(
      "OR LogAttributes['session.id'] IN (\n     SELECT DISTINCT LogAttributes['session.id']",
    );
    expect(sql).toContain("SELECT DISTINCT TraceId FROM otel_logs");
    const gates = sql.match(
      /ResourceAttributes\['platform\.agent\.id'\] IN \{agentIds:Array\(String\)\}/g,
    );
    expect(gates).toHaveLength(3);
  });

  it("scopes to Claude Code telemetry by Body, not template ServiceName", () => {
    const sql = ownedApiRequests({ hours: 24 });
    expect(sql).toContain("Body = 'claude_code.api_request'");
    expect(sql).not.toContain("ServiceName");
  });

  it("bounds by the absolute range as half-open [from, to)", () => {
    const sql = ownedApiRequests({
      fromIso: "2026-07-01",
      toIso: "2026-08-01",
    });
    expect(sql).toContain(
      "Timestamp >= parseDateTimeBestEffort({fromIso:String})",
    );
    expect(sql).toContain(
      "Timestamp < parseDateTimeBestEffort({toIso:String})",
    );
  });

  it("applies no session predicate without a sessionId", () => {
    const sql = ownedApiRequests({ hours: 24 });
    expect(sql).not.toContain("sessionId");
    expect(sql).not.toContain("TraceId");
    expect(sql).toContain("toIntervalHour({hours:UInt32})");
  });
});
