import { describe, expect, it } from "vitest";
import {
  callsCte,
  CreditPayloadError,
  credits,
} from "../../modules/metrics/infrastructure/clickhouse-reader.js";

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
  it("takes latency from the span duration, not the seconds-declared attribute", () => {
    const sql = callsCte({ hours: 24 });
    expect(sql).toContain("Duration / 1e6 AS durMs");
    expect(sql).not.toContain("gen_ai.client.operation.duration");
  });
});
