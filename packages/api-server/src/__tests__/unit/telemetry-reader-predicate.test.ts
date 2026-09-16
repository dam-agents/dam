import { describe, expect, it } from "vitest";

import { ownedLogs, ownedSpans } from "../../modules/telemetry/index.js";

/**
 * TEST_OVERVIEW: the owner gate is the only thing standing between one user's
 * timeline read and another's, so it is asserted on every predicate the reader
 * can build, including the ones with no window and no filters.
 */

const GATE =
  "ResourceAttributes['platform.agent.id'] IN {agentIds:Array(String)}";

describe("ownedSpans", () => {
  it("gates on the trusted agent attribute even with no window", () => {
    expect(ownedSpans({})).toContain(GATE);
  });

  it("bounds a relative window in hours", () => {
    expect(ownedSpans({ hours: 24 })).toContain(
      "Timestamp >= now() - toIntervalHour({hours:UInt32})",
    );
  });

  it("bounds an absolute range as half-open [from, to)", () => {
    const sql = ownedSpans({
      fromIso: "2026-09-01T00:00:00Z",
      toIso: "2026-09-02T00:00:00Z",
    });
    expect(sql).toContain(
      "Timestamp >= parseDateTimeBestEffort({fromIso:String})",
    );
    expect(sql).toContain(
      "Timestamp < parseDateTimeBestEffort({toIso:String})",
    );
  });

  it("never scopes by service name, which carries the template", () => {
    expect(ownedSpans({ hours: 1 })).not.toContain("ServiceName");
  });
});

describe("ownedLogs", () => {
  it("gates on the trusted agent attribute even with no filters", () => {
    expect(ownedLogs({})).toContain(GATE);
  });

  it("binds every caller-supplied filter as a query parameter", () => {
    // TEST_SCENARIO: nothing the caller sends may reach the SQL as text.
    const sql = ownedLogs({
      traceId: "abc",
      sessionId: "s-1",
      event: "claude_code.api_request",
      contains: "boom",
    });
    expect(sql).toContain("TraceId = {traceId:String}");
    expect(sql).toContain("LogAttributes['session.id'] = {sessionId:String}");
    expect(sql).toContain("Body = {event:String}");
    expect(sql).toContain("{contains:String}");
    expect(sql).not.toContain("abc");
    expect(sql).not.toContain("boom");
  });

  it("keeps the owner gate when a trace is named", () => {
    /**
     * TEST_SCENARIO: naming a trace id must not become a way to read someone
     * else's records.
     */
    expect(ownedLogs({ traceId: "deadbeef" })).toContain(GATE);
  });

  it("searches the record body and its attribute values together", () => {
    const sql = ownedLogs({ contains: "x" });
    expect(sql).toContain(
      "positionCaseInsensitiveUTF8(Body, {contains:String})",
    );
    expect(sql).toContain("mapValues(LogAttributes)");
  });
});
