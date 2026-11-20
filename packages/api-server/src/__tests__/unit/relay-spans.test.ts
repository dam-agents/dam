// TEST_OVERVIEW: a slow session open can be broken down from traces: each relay hold records how long it waited, what the agent was when it began and how it ended, and each forwarded session load or transcript tail read records the agent's answer time, linked to the hold it waited behind. None of it names an agent, an owner or a session.
import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createRequestSpans,
  startHoldSpan,
} from "../../apps/api-server/agent-proxies/relay-spans.js";

let spans: InMemorySpanExporter;
let provider: TracerProvider;

beforeEach(() => {
  spans = new InMemorySpanExporter();
  context.setGlobalContextManager(new AsyncLocalStorageContextManager());
  provider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter: spans })],
  });
  trace.setGlobalTracerProvider(provider);
});

afterEach(async () => {
  await provider.shutdown();
  context.disable();
  trace.disable();
});

const loads = (frame: unknown) =>
  (frame as { method?: string } | null)?.method === "session/load"
    ? "session/load"
    : null;

describe("relay hold span", () => {
  it("records how the hold began and ended, once", () => {
    const hold = startHoldSpan("acp", "running");
    hold.end("answered");
    hold.end("gone");
    const [span] = spans.getFinishedSpans();
    expect(spans.getFinishedSpans()).toHaveLength(1);
    expect(span!.name).toBe("relay.hold");
    expect(span!.attributes).toEqual({
      "platform.relay": "acp",
      "platform.relay.hold.start": "running",
      "platform.relay.hold.end": "answered",
    });
  });

  // TEST_SCENARIO: a wake that fails is an error span carrying the error's type, never its message, which is free text.
  it("marks a failed hold with the error type only", () => {
    class AgentWakeTimeoutError extends Error {
      override name = "AgentWakeTimeoutError";
    }
    startHoldSpan("trpc", "hibernated").end(
      "failed",
      new AgentWakeTimeoutError("agent-a did not wake"),
    );
    const [span] = spans.getFinishedSpans();
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);
    expect(span!.attributes["error.type"]).toBe("AgentWakeTimeoutError");
    expect(JSON.stringify(span!.attributes)).not.toContain("agent-a");
  });
});

describe("relay request spans", () => {
  // TEST_SCENARIO: the session load is timed from the frame reaching the agent to the agent's answer of the same id; notifications in between are not the answer, and the time the frame waited for the hold rides along.
  it("times a session load to its answer and links it to the hold", () => {
    const hold = startHoldSpan("acp", "ready");
    hold.end("ready");
    const requests = createRequestSpans("acp", loads, () => hold.link());
    requests.sent(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "session/load",
        params: { sessionId: "sess-secret" },
      }),
      1200,
    );
    requests.sent(
      JSON.stringify({ jsonrpc: "2.0", id: 8, method: "initialize" }),
      0,
    );
    requests.answered(
      Buffer.from(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: "sess-secret" },
        }),
      ),
    );
    expect(spans.getFinishedSpans().map((s) => s.name)).toEqual(["relay.hold"]);
    requests.answered(
      Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 7, result: {} })),
    );
    const request = spans
      .getFinishedSpans()
      .find((s) => s.name === "relay.request")!;
    expect(request.attributes).toEqual({
      "platform.relay": "acp",
      "rpc.method": "session/load",
      "platform.relay.queued_ms": 1200,
      "platform.relay.request.outcome": "ok",
    });
    expect(request.links.map((l) => l.context.spanId)).toEqual([
      spans
        .getFinishedSpans()
        .find((s) => s.name === "relay.hold")!
        .spanContext().spanId,
    ]);
  });

  it("reads the answer of a tRPC query, whose id comes first", () => {
    const requests = createRequestSpans("trpc", (frame) =>
      (frame as { params?: { path?: string } }).params?.path ===
      "sessions.history"
        ? "sessions.history"
        : null,
    );
    requests.sent(
      JSON.stringify([
        {
          id: 3,
          jsonrpc: "2.0",
          method: "query",
          params: { path: "sessions.history", input: { sessionId: "s" } },
        },
      ]),
      0,
    );
    requests.answered(
      JSON.stringify({ id: 3, jsonrpc: "2.0", error: { message: "boom" } }),
    );
    const [span] = spans.getFinishedSpans();
    expect(span!.attributes["platform.relay.request.outcome"]).toBe("error");
  });

  it("ends a load the socket closed on as unanswered", () => {
    const requests = createRequestSpans("acp", loads);
    requests.sent(JSON.stringify({ id: "a", method: "session/load" }), 0);
    requests.close();
    const [span] = spans.getFinishedSpans();
    expect(span!.attributes["platform.relay.request.outcome"]).toBe(
      "unanswered",
    );
  });
});
