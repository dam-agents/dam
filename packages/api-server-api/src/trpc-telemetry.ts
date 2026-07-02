// Per-procedure telemetry for both tRPC instances (t and harnessT): one
// INTERNAL span per procedure call plus duration/outcome metrics, keyed by
// procedure path. HTTP-level instrumentation can't see the procedure (all
// calls share the /api/trpc/* route, batches share one request), so this
// middleware is what makes "per-operation rate/latency/errors" possible.
//
// Depends ONLY on @opentelemetry/api: with no SDK registered (tests, dev, the
// telemetry-disabled deployment) every call is a no-op on a non-recording
// span. The SDK is registered process-wide by the api-server's --import
// bootstrap before this bundle evaluates.
import {
  context,
  metrics,
  trace,
  SpanKind,
  SpanStatusCode,
  type Counter,
  type Histogram,
} from "@opentelemetry/api";

const SCOPE = "platform-apiserver";

interface Instruments {
  duration: Histogram;
  total: Counter;
}

// Created lazily: unlike tracers (ProxyTracerProvider), a meter obtained
// before the global MeterProvider is registered stays no-op forever, and this
// module (bundled into the server) evaluates only after the bootstrap ran.
let instruments: Instruments | null = null;

function getInstruments(): Instruments {
  if (!instruments) {
    const meter = metrics.getMeter(SCOPE);
    instruments = {
      duration: meter.createHistogram("platform.trpc.duration", {
        description: "Wall-clock of one tRPC procedure call",
        unit: "s",
      }),
      total: meter.createCounter("platform.trpc.total", {
        description: "tRPC procedure calls by outcome",
      }),
    };
  }
  return instruments;
}

/** Drops the memoized instruments so a test can install its own MeterProvider. */
export function resetTrpcTelemetryForTest(): void {
  instruments = null;
}

/**
 * Wraps one tRPC procedure invocation in a span and records its metrics.
 * tRPC middlewares surface failures via `result.ok`/`result.error` rather
 * than throwing; the catch branch is defensive only.
 */
export async function withTrpcTelemetry<R extends { ok: boolean }>(
  path: string,
  type: "query" | "mutation" | "subscription",
  next: () => Promise<R>,
): Promise<R> {
  const span = trace.getTracer(SCOPE).startSpan(`trpc.${path}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      "rpc.system": "trpc",
      "trpc.procedure": path,
      "trpc.type": type,
    },
  });
  const start = performance.now();
  let errorCode: string | undefined;
  try {
    const result = await context.with(
      trace.setSpan(context.active(), span),
      next,
    );
    if (!result.ok) {
      const error = (result as { error?: { code?: string } }).error;
      errorCode = error?.code ?? "UNKNOWN";
    }
    return result;
  } catch (err) {
    errorCode = "UNKNOWN";
    span.recordException(err instanceof Error ? err : new Error(String(err)));
    throw err;
  } finally {
    if (errorCode) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorCode });
    }
    span.end();
    const attributes = {
      "trpc.procedure": path,
      "trpc.type": type,
      ...(errorCode ? { "error.code": errorCode } : {}),
    };
    const { duration, total } = getInstruments();
    duration.record((performance.now() - start) / 1000, attributes);
    total.add(1, attributes);
  }
}
