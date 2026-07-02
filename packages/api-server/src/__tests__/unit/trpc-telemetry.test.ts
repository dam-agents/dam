import { context, metrics, trace, SpanStatusCode } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetTrpcTelemetryForTest,
  withTrpcTelemetry,
} from "api-server-api/trpc-telemetry";

describe("withTrpcTelemetry", () => {
  let spans: InMemorySpanExporter;
  let reader: PeriodicExportingMetricReader;
  let tracerProvider: NodeTracerProvider;
  let meterProvider: MeterProvider;

  beforeEach(() => {
    spans = new InMemorySpanExporter();
    tracerProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spans)],
    });
    // register() installs the tracer provider AND the AsyncLocalStorage
    // context manager the nesting assertions rely on.
    tracerProvider.register();
    reader = new PeriodicExportingMetricReader({
      exporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
      exportIntervalMillis: 3_600_000,
    });
    meterProvider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(meterProvider);
    resetTrpcTelemetryForTest();
  });

  afterEach(async () => {
    await tracerProvider.shutdown();
    await meterProvider.shutdown();
    trace.disable();
    metrics.disable();
    context.disable();
    resetTrpcTelemetryForTest();
  });

  async function collectMetrics() {
    const { resourceMetrics } = await reader.collect();
    const byName = new Map(
      resourceMetrics.scopeMetrics.flatMap((scope) =>
        scope.metrics.map((m) => [m.descriptor.name, m]),
      ),
    );
    return byName;
  }

  it("records a span and metrics for a successful call", async () => {
    const result = await withTrpcTelemetry(
      "agents.list",
      "query",
      async () => ({
        ok: true,
        data: [],
      }),
    );
    expect(result.ok).toBe(true);

    const [span] = spans.getFinishedSpans();
    expect(span.name).toBe("trpc.agents.list");
    expect(span.attributes["rpc.system"]).toBe("trpc");
    expect(span.attributes["trpc.procedure"]).toBe("agents.list");
    expect(span.attributes["trpc.type"]).toBe("query");
    expect(span.status.code).toBe(SpanStatusCode.UNSET);

    const byName = await collectMetrics();
    const duration = byName.get("platform.trpc.duration");
    const total = byName.get("platform.trpc.total");
    expect(duration?.dataPoints).toHaveLength(1);
    expect(total?.dataPoints[0]?.value).toBe(1);
    expect(total?.dataPoints[0]?.attributes).toEqual({
      "trpc.procedure": "agents.list",
      "trpc.type": "query",
    });
  });

  it("marks tRPC error results with the error code", async () => {
    const result = await withTrpcTelemetry(
      "agents.delete",
      "mutation",
      async () => ({
        ok: false,
        error: new TRPCError({ code: "FORBIDDEN" }),
      }),
    );
    expect(result.ok).toBe(false);

    const [span] = spans.getFinishedSpans();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBe("FORBIDDEN");

    const byName = await collectMetrics();
    expect(
      byName.get("platform.trpc.total")?.dataPoints[0]?.attributes,
    ).toEqual({
      "trpc.procedure": "agents.delete",
      "trpc.type": "mutation",
      "error.code": "FORBIDDEN",
    });
  });

  it("rethrows and records a thrown error as UNKNOWN", async () => {
    await expect(
      withTrpcTelemetry("agents.get", "query", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const [span] = spans.getFinishedSpans();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.events.some((e) => e.name === "exception")).toBe(true);

    const byName = await collectMetrics();
    expect(
      byName.get("platform.trpc.total")?.dataPoints[0]?.attributes,
    ).toMatchObject({
      "error.code": "UNKNOWN",
    });
  });

  it("makes the procedure span active inside next and nests under a parent", async () => {
    const tracer = trace.getTracer("test");
    await tracer.startActiveSpan("http.request", async (parent) => {
      await withTrpcTelemetry("agents.list", "query", async () => {
        expect(trace.getActiveSpan()?.spanContext().spanId).not.toBe(
          parent.spanContext().spanId,
        );
        return { ok: true };
      });
      parent.end();
    });

    const finished = spans.getFinishedSpans();
    const child = finished.find((s) => s.name === "trpc.agents.list");
    const parent = finished.find((s) => s.name === "http.request");
    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
  });

  it("does not poison instruments when called before a meter provider exists", async () => {
    metrics.disable();
    resetTrpcTelemetryForTest();
    await withTrpcTelemetry("agents.list", "query", async () => ({ ok: true }));

    // Re-register and reset: the next call must reach the real provider.
    metrics.setGlobalMeterProvider(meterProvider);
    resetTrpcTelemetryForTest();
    await withTrpcTelemetry("agents.list", "query", async () => ({ ok: true }));

    const byName = await collectMetrics();
    expect(byName.get("platform.trpc.total")?.dataPoints[0]?.value).toBe(1);
  });
});
