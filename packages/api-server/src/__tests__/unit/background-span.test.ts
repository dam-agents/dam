/** TEST_OVERVIEW: background work — a schedule fire, a channel turn — traced
 *  as a trace of its own, linked to whatever started it, carrying only bounded
 *  attributes and never an error's free-text message. */
import { trace, SpanStatusCode } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { annotateSpan, inBackgroundSpan } from "../../core/background-span.js";

describe("inBackgroundSpan", () => {
  let spans: InMemorySpanExporter;
  let tracerProvider: NodeTracerProvider;

  beforeEach(() => {
    spans = new InMemorySpanExporter();
    tracerProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spans)],
    });
    tracerProvider.register();
  });

  afterEach(async () => {
    await tracerProvider.shutdown();
    trace.disable();
  });

  /** TEST_SCENARIO: a turn outlives the request that started it, so it opens
   *  its own trace and links back rather than nesting under the request. */
  it("opens a new root linked to the caller's span", async () => {
    await trace.getTracer("test").startActiveSpan("caller", async (caller) => {
      await inBackgroundSpan("work", { "platform.kind": "test" }, async () => {
        annotateSpan({ "platform.outcome": "success" });
      });
      caller.end();
    });

    const finished = spans.getFinishedSpans();
    const work = finished.find((s) => s.name === "work")!;
    const caller = finished.find((s) => s.name === "caller")!;
    expect(work.parentSpanContext).toBeUndefined();
    expect(work.spanContext().traceId).not.toBe(caller.spanContext().traceId);
    expect(work.links.map((l) => l.context.spanId)).toEqual([
      caller.spanContext().spanId,
    ]);
    expect(work.attributes).toEqual({
      "platform.kind": "test",
      "platform.outcome": "success",
    });
  });

  /** TEST_SCENARIO: an error message is free text that can carry identifiers,
   *  so a failure records its type and status, not its message. */
  it("marks a failure with its error type and rethrows", async () => {
    class WakeTimeout extends Error {
      override name = "WakeTimeout";
    }
    await expect(
      inBackgroundSpan("work", {}, async () => {
        throw new WakeTimeout("agent agent-123 of user-456 did not wake");
      }),
    ).rejects.toThrow(WakeTimeout);

    const [work] = spans.getFinishedSpans();
    expect(work!.status.code).toBe(SpanStatusCode.ERROR);
    expect(work!.status.message).toBeUndefined();
    expect(work!.attributes).toEqual({ "error.type": "WakeTimeout" });
    expect(work!.events).toEqual([]);
  });
});
