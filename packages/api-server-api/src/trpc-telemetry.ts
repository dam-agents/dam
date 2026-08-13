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

export function resetTrpcTelemetryForTest(): void {
  instruments = null;
}

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
