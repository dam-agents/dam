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
    expect(gates).toHaveLength((sql.match(/FROM otel_logs/g) ?? []).length + 1);
  });

  it("scopes to call records by Body, not template ServiceName", () => {
    const sql = ownedApiRequests({ hours: 24 });
    expect(sql).toContain(
      "Body IN ('claude_code.api_request', 'pi.api_request', 'codex.response_completed')",
    );
    expect(sql).toContain("Body = 'platform.model_call'");
    expect(sql).not.toContain("ServiceName");
  });

  /**
   * TEST_SCENARIO: An agent on the Model Router exports one record per call
   * from the router and, on Claude Code, a second from the harness. The read
   * sums the router's records for every agent that has any in the window and
   * the harness's (Claude Code's, Pi's) for the rest, decided from the data,
   * each agent and invocation from its own first router record on.
   */
  it("prefers the router's records per agent and keeps the harness's records of calls the router never saw", () => {
    const sql = ownedApiRequests({ hours: 24 });
    const key =
      "(ResourceAttributes['platform.agent.id'], ResourceAttributes['platform.invocation.id'])";
    expect(sql).toContain(
      `AND (${key} NOT IN (SELECT DISTINCT ${key} FROM otel_logs`,
    );
    expect(sql).toContain(
      "OR Timestamp < (SELECT mapFromArrays(groupArray(k), groupArray(m)) FROM (SELECT concat(ResourceAttributes['platform.agent.id'], '|', ResourceAttributes['platform.invocation.id']) AS k, min(Timestamp) AS m FROM otel_logs",
    );
    expect(sql).not.toContain("SELECT min(Timestamp) FROM otel_logs");
  });

  /**
   * TEST_SCENARIO: #4620 routed regular models, and a later release started
   * routing a Bedrock Connection. One agent therefore has a regular routed
   * call and, after it, a native Bedrock call the router never recorded:
   * both are real calls and both count. A Bedrock call the router did record
   * counts once, from the router's record. The unit suite has no ClickHouse,
   * so the counts run against a model of the clauses this test pins, and the
   * guard that couples the native record to the agent's own Bedrock cutover
   * is asserted on the SQL itself.
   */
  it("keeps a native Bedrock call from before the agent's Bedrock cutover", () => {
    const sql = ownedApiRequests({ hours: 24 });
    const key =
      "(ResourceAttributes['platform.agent.id'], ResourceAttributes['platform.invocation.id'])";
    expect(sql).toContain(
      `OR ((Body = 'claude_code.api_request' AND LogAttributes['model'] NOT LIKE 'claude/%') AND (${key} NOT IN (SELECT DISTINCT ${key} FROM otel_logs WHERE Body = 'platform.model_call' AND LogAttributes['platform.provider.alias'] = 'bedrock'`,
    );

    interface Record {
      at: number;
      router: boolean;
      bedrockRouter: boolean;
      native: boolean;
    }
    const counted = (records: Record[]): number => {
      const routers = records.filter((r) => r.router);
      const bedrockRouters = records.filter((r) => r.bedrockRouter);
      const firstAt = (rows: Record[]) => Math.min(...rows.map((r) => r.at));
      return records.filter((record) => {
        if (record.router) return true;
        if (routers.length === 0 || record.at < firstAt(routers)) return true;
        return (
          record.native &&
          (bedrockRouters.length === 0 || record.at < firstAt(bedrockRouters))
        );
      }).length;
    };

    const regularCall = { at: 10, router: true, bedrockRouter: false };
    const nativeBedrock = { at: 20, router: false, bedrockRouter: false };
    const routedBedrock = { at: 30, router: true, bedrockRouter: true };

    expect(
      counted([
        { ...regularCall, native: false },
        { ...nativeBedrock, native: true },
      ]),
      "a regular routed call plus a Bedrock call the router never recorded",
    ).toBe(2);
    expect(
      counted([
        { ...routedBedrock, native: false },
        { at: 30, router: false, bedrockRouter: false, native: true },
      ]),
      "one Bedrock call the router recorded, with Claude Code's record beside it",
    ).toBe(1);
    expect(
      counted([
        { ...regularCall, native: false },
        { ...nativeBedrock, native: true },
        { ...routedBedrock, native: false },
        { at: 31, router: false, bedrockRouter: false, native: true },
      ]),
      "a cutover mid-window: the native call before it and the routed one after it",
    ).toBe(3);
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
    expect(sql).not.toContain("session.id");
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
    expect(ownedAgentLogs({ hours: 24 })).not.toContain("Body IN");
    expect(ownedApiRequests({ hours: 24 })).toContain("Body IN");
  });

  /**
   * TEST_SCENARIO: Spans carry no session id, so a narrowed span read reaches
   * the session through the trace family of its call records. It must resolve
   * that family from the *folded* session set — the queried session plus any run
   * it spawned — because the cost and record reads fold the same way. Resolving
   * from the literal session alone would let one sessionId mean a wider set of
   * runs to the numbers than to the spans, so a spawned run would be counted and
   * not shown.
   */
  it("narrows spans to the folded session's trace family", () => {
    const sql = ownedAgentSpans({ hours: 24, sessionId: "s-1" });
    expect(sql).toContain("TraceId IN (");
    expect(sql).toContain("SELECT DISTINCT TraceId FROM otel_logs");
    expect(sql).toContain(
      "OR LogAttributes['session.id'] IN (\n     SELECT DISTINCT LogAttributes['session.id']",
    );
  });

  // TEST_SCENARIO: The trace family is resolved inside the query, so no unbounded list of trace ids is carried out of the store and injected back into a follow-up read.
  it("resolves the trace family in the query, not through a bound parameter", () => {
    const sql = ownedAgentSpans({ hours: 24, sessionId: "s-1" });
    expect(sql).not.toContain("{traceIds:Array(String)}");
  });

  // TEST_SCENARIO: Without a session the span read is a plain owned-window scan; a stray join here would cost a trace resolution on every call.
  it("applies no trace filter to spans without a sessionId", () => {
    const sql = ownedAgentSpans({ hours: 24 });
    expect(sql).not.toContain("TraceId");
    expect(sql).toContain(AGENT_GATE);
  });
});
