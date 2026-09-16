import type { TelemetrySpan } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  attachLogsToSpans,
  type UnattachedLog,
} from "../../modules/telemetry/index.js";

/**
 * TEST_OVERVIEW: the fold that positions a log record inside a trace. Claude
 * Code stamps an api_request record with the enclosing interaction span, never
 * the llm_request span that made the call, so the request id is what puts a
 * cost on the right bar.
 */

const span = (over: Partial<TelemetrySpan>): TelemetrySpan => ({
  spanId: "s1",
  parentSpanId: "",
  name: "claude_code.interaction",
  kind: "SPAN_KIND_INTERNAL",
  service: "nous",
  startedAt: "2026-09-14T10:00:00.000Z",
  durationMs: 1000,
  statusCode: "STATUS_CODE_UNSET",
  statusMessage: "",
  agentId: "a1",
  invocationId: null,
  attributes: {},
  ...over,
});

const log = (over: Partial<UnattachedLog>): UnattachedLog => ({
  at: "2026-09-14T10:00:00.500Z",
  spanId: "",
  traceId: "t1",
  event: "claude_code.api_request",
  severity: "INFO",
  service: "nous",
  agentId: "a1",
  invocationId: null,
  attributes: {},
  ...over,
});

describe("attachLogsToSpans", () => {
  it("prefers the call's own span over the span the record names", () => {
    /**
     * TEST_SCENARIO: the record carries the interaction's SpanId but the
     * llm_request span shares its client_request_id.
     */
    const spans = [
      span({ spanId: "interaction" }),
      span({
        spanId: "call",
        parentSpanId: "interaction",
        name: "claude_code.llm_request",
        attributes: { client_request_id: "req_1" },
      }),
    ];
    const [attached] = attachLogsToSpans(spans, [
      log({
        spanId: "interaction",
        attributes: { client_request_id: "req_1" },
      }),
    ]);

    expect(attached?.attachedTo).toBe("call");
    expect(attached?.attachedBy).toBe("request-id");
  });

  it("falls back to request_id when no client_request_id is present", () => {
    const spans = [
      span({ spanId: "call", attributes: { request_id: "srv_9" } }),
    ];
    const [attached] = attachLogsToSpans(spans, [
      log({ attributes: { request_id: "srv_9" } }),
    ]);

    expect(attached?.attachedTo).toBe("call");
    expect(attached?.attachedBy).toBe("request-id");
  });

  it("falls back to the record's own span when no request id matches", () => {
    const spans = [span({ spanId: "interaction" })];
    const [attached] = attachLogsToSpans(spans, [
      log({
        spanId: "interaction",
        attributes: { client_request_id: "req_x" },
      }),
    ]);

    expect(attached?.attachedTo).toBe("interaction");
    expect(attached?.attachedBy).toBe("span-id");
  });

  it("leaves a record loose when its span is absent from the trace", () => {
    // TEST_SCENARIO: the span cap dropped the span the record points at.
    const [attached] = attachLogsToSpans(
      [span({ spanId: "kept" })],
      [log({ spanId: "dropped" })],
    );

    expect(attached?.attachedTo).toBeNull();
    expect(attached?.attachedBy).toBe("trace-root");
  });

  it("leaves every record loose when the trace has no spans at all", () => {
    /**
     * TEST_SCENARIO: a harness whose span export is off still has log
     * records sharing a TraceId, which is what keeps the surface useful.
     */
    const attached = attachLogsToSpans([], [log({}), log({ spanId: "s9" })]);

    expect(attached.map((a) => a.attachedBy)).toEqual([
      "trace-root",
      "trace-root",
    ]);
  });

  it("ignores an empty request id rather than matching every empty one", () => {
    const spans = [
      span({ spanId: "call", attributes: { client_request_id: "" } }),
    ];
    const [attached] = attachLogsToSpans(spans, [
      log({ attributes: { client_request_id: "" } }),
    ]);

    expect(attached?.attachedBy).toBe("trace-root");
  });
});
