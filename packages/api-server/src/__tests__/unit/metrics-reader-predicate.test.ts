import { describe, expect, it } from "vitest";
import {
  ownedAgentLogs,
  ownedAgentSpans,
  ownedApiRequests,
} from "../../modules/metrics/infrastructure/clickhouse-reader.js";

const AGENT_GATE =
  "ResourceAttributes['platform.agent.id'] IN {agentIds:Array(String)}";

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

describe("agent-scoped record predicates", () => {
  /**
   * TEST_SCENARIO: The trusted, gateway-stamped agent id is the only thing
   * standing between one agent's self-read and another agent's telemetry. Every
   * predicate — including the ones that widen past the LLM-call body shape —
   * must carry it, with and without a session narrowing.
   */
  it("gates every read on the trusted agent attribution", () => {
    for (const window of [{ hours: 24 }, { hours: 24, sessionId: "s-1" }]) {
      for (const sql of [
        ownedApiRequests(window),
        ownedAgentLogs(window),
        ownedAgentSpans(window),
      ]) {
        expect(sql).toContain(AGENT_GATE);
      }
    }
  });

  // TEST_SCENARIO: The events read serves every record the agent emitted — errors and tool decisions included — so unlike the spend reads it must not narrow to the LLM-call body.
  it("reads every emitted record, not only LLM calls", () => {
    expect(ownedAgentLogs({ hours: 24 })).not.toContain("Body =");
    expect(ownedApiRequests({ hours: 24 })).toContain("Body =");
  });

  // TEST_SCENARIO: Spans carry no session id, so narrowing them to a session has to go through the trace family that session's calls belong to — otherwise a session-scoped span read would silently return the agent's whole window.
  it("narrows spans to a session by its trace family", () => {
    const sql = ownedAgentSpans({ hours: 24, sessionId: "s-1" });
    expect(sql).toContain("TraceId IN (");
    expect(sql).toContain("SELECT DISTINCT TraceId FROM otel_logs");
    expect(sql).toContain("LogAttributes['session.id'] = {sessionId:String}");
  });

  // TEST_SCENARIO: Without a session the span read is a plain owned-window scan; a stray join here would cost a full trace resolution on every call.
  it("applies no trace fold to spans without a sessionId", () => {
    const sql = ownedAgentSpans({ hours: 24 });
    expect(sql).not.toContain("sessionId");
    expect(sql).not.toContain("TraceId");
  });
});
