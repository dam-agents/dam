import { describe, expect, it } from "vitest";
import {
  callsCte,
  CreditPayloadError,
  credits,
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

describe("callsCte", () => {
  it("unions both harness shapes under one owner-gated window", () => {
    const sql = callsCte({ hours: 24 });
    expect(sql).toContain("Body = 'claude_code.api_request'");
    expect(sql).toContain("SpanName = 'LLM Generation'");
    expect(sql).toContain("FROM otel_logs");
    expect(sql).toContain("FROM otel_traces");
    expect(sql).not.toContain("ServiceName");
    const gates = sql.match(
      /ResourceAttributes\['platform\.agent\.id'\] IN \{agentIds:Array\(String\)\}/g,
    );
    expect(gates).toHaveLength(2);
  });

  it("carries Bob's cost as a credit rather than into the dollar column", () => {
    const sql = callsCte({ hours: 24 });
    expect(sql).toContain(
      "toFloat64OrZero(SpanAttributes['gen_ai.usage.cost']) AS creditAmount",
    );
    expect(sql).toContain("'bobcoin' AS creditUnit");
    expect(sql).toContain("toFloat64(0) AS usd");
  });

  it("folds in whole sessions sharing the queried session's trace", () => {
    const sql = callsCte({ sessionId: "s-1" });
    expect(sql).toContain("sessionId = {sessionId:String}");
    expect(sql).toContain("SELECT DISTINCT traceId FROM calls_all");
  });

  it("bounds by the absolute range as half-open [from, to)", () => {
    const sql = callsCte({ fromIso: "2026-07-01", toIso: "2026-08-01" });
    expect(sql).toContain(
      "Timestamp >= parseDateTimeBestEffort({fromIso:String})",
    );
    expect(sql).toContain(
      "Timestamp < parseDateTimeBestEffort({toIso:String})",
    );
  });

  it("applies no session predicate without a sessionId", () => {
    const sql = callsCte({ hours: 24 });
    expect(sql).not.toContain("sessionId:String");
    expect(sql).toContain("toIntervalHour({hours:UInt32})");
  });
});

describe("credit payload decoding", () => {
  it("rejects a sumMap shape it does not recognise instead of reporting no credits", () => {
    expect(credits([["bobcoin"], [12.5]])).toEqual([
      { unit: "bobcoin", amount: 12.5 },
    ]);
    expect(
      credits([
        ["", "bobcoin"],
        [0, 3],
      ]),
    ).toEqual([{ unit: "bobcoin", amount: 3 }]);
    expect(() => credits(undefined)).toThrow(CreditPayloadError);
    expect(() => credits([["bobcoin"]])).toThrow(CreditPayloadError);
    expect(() => credits([["bobcoin"], []])).toThrow(CreditPayloadError);
    expect(() => credits([["bobcoin"], ["nope"]])).toThrow(CreditPayloadError);
    expect(() => credits([[7], [1]])).toThrow(CreditPayloadError);
  });
});

describe("Bob latency unit", () => {
  it("takes latency from the span duration as integer milliseconds, the type the log-record branch already has", () => {
    const sql = callsCte({ hours: 24 });
    expect(sql).toContain("toInt64(intDiv(Duration, 1000000)) AS durMs");
    expect(sql).toContain(
      "toInt64OrZero(LogAttributes['duration_ms']) AS durMs",
    );
    expect(sql).not.toContain("gen_ai.client.operation.duration");
  });
});
