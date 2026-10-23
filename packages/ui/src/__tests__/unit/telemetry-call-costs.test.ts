import type {
  SpendCallCost,
  TelemetryLog,
  TelemetrySpan,
  TurnDetail,
} from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  callCostOf,
  ROUTER_CALL_ID,
  routerCallIdsOf,
} from "../../modules/telemetry/lib/call-costs.js";

const log = (attributes: Record<string, string>): TelemetryLog => ({
  at: "2026-10-22T10:00:00.000Z",
  spanId: "span-1",
  traceId: "trace-1",
  event: "event",
  severity: "info",
  service: "service",
  agentId: "agent-1",
  invocationId: null,
  attributes,
  attachedTo: null,
  attachedBy: "request-id",
});

const span = (attributes: Record<string, string>): TelemetrySpan => ({
  spanId: "span-1",
  parentSpanId: "",
  traceId: "trace-1",
  name: "call",
  kind: "client",
  service: "service",
  startedAt: "2026-10-22T10:00:00.000Z",
  durationMs: 1000,
  statusCode: "OK",
  statusMessage: "",
  agentId: "agent-1",
  invocationId: null,
  attributes,
});

const turn = (logs: TelemetryLog[]): TurnDetail => ({
  turnId: "turn-1",
  promptId: "prompt-1",
  startedAt: "2026-10-22T10:00:00.000Z",
  durationMs: 1000,
  spans: [],
  logs,
  spansTruncated: false,
  logsTruncated: false,
});

const cost = (routerCallId: string): SpendCallCost => ({
  routerCallId,
  unit: "usd",
  costMicros: 1000,
  estimated: false,
});

const router = log({ [ROUTER_CALL_ID]: "call-1", request_id: "req-1" });
const harness = log({ request_id: "req-1" });
const costs = new Map([["call-1", cost("call-1")]]);

describe("routerCallIdsOf", () => {
  it("names each router call once", () => {
    expect(routerCallIdsOf(turn([router, router, harness]))).toEqual([
      "call-1",
    ]);
  });
});

describe("callCostOf", () => {
  it("prices a router record by its call id", () => {
    expect(callCostOf(turn([router]), costs).log(router)?.routerCallId).toBe(
      "call-1",
    );
  });

  it("prices a harness record and a span by the request id they share", () => {
    const of = callCostOf(turn([router]), costs);
    expect(of.log(harness)?.routerCallId).toBe("call-1");
    expect(of.span(span({ request_id: "req-1" }), [])?.routerCallId).toBe(
      "call-1",
    );
  });

  it("prices a span from its own logs when it carries no request id", () => {
    expect(
      callCostOf(turn([router]), costs).span(span({}), [harness])?.routerCallId,
    ).toBe("call-1");
  });

  it("names no cost for a call the read did not return", () => {
    const of = callCostOf(turn([router]), costs);
    expect(of.log(log({ request_id: "req-2" }))).toBeUndefined();
    expect(of.span(span({ request_id: "req-2" }), [])).toBeUndefined();
  });
});
