import { isOtelEnabled } from "./telemetry-gate.js";

if (isOtelEnabled(process.env)) {
  const { register } = await import("node:module");
  const { createAddHookMessageChannel } = await import("import-in-the-middle");

  const { registerOptions, waitForAllMessagesAcknowledged } =
    createAddHookMessageChannel();
  register("import-in-the-middle/hook.mjs", import.meta.url, registerOptions);

  const [
    { NodeSDK, logs, metrics, resources },
    { OTLPTraceExporter },
    { OTLPMetricExporter },
    { OTLPLogExporter },
    { HttpInstrumentation },
    { UndiciInstrumentation },
    { GrpcInstrumentation },
    { IORedisInstrumentation },
    { PinoInstrumentation },
    { PgInstrumentation },
    { RuntimeNodeInstrumentation },
  ] = await Promise.all([
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/exporter-trace-otlp-proto"),
    import("@opentelemetry/exporter-metrics-otlp-proto"),
    import("@opentelemetry/exporter-logs-otlp-proto"),
    import("@opentelemetry/instrumentation-http"),
    import("@opentelemetry/instrumentation-undici"),
    import("@opentelemetry/instrumentation-grpc"),
    import("@opentelemetry/instrumentation-ioredis"),
    import("@opentelemetry/instrumentation-pino"),
    import("@opentelemetry/instrumentation-pg"),
    import("@opentelemetry/instrumentation-runtime-node"),
  ]);

  const sdk = new NodeSDK({
    resource: resources.resourceFromAttributes({
      "service.version": process.env.PLATFORM_APP_VERSION ?? "0.0.0",
    }),
    traceExporter: new OTLPTraceExporter(),
    metricReaders: [
      new metrics.PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
      }),
    ],
    logRecordProcessors: [
      new logs.BatchLogRecordProcessor(new OTLPLogExporter()),
    ],
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => {
          const path = (req.url ?? "").split("?", 1)[0];
          return path === "/api/health" || path === "/api/ready";
        },
      }),
      new UndiciInstrumentation(),
      new GrpcInstrumentation(),
      new IORedisInstrumentation(),
      new PinoInstrumentation(),
      new PgInstrumentation(),
      new RuntimeNodeInstrumentation(),
    ],
  });
  sdk.start();

  (globalThis as Record<symbol, unknown>)[
    Symbol.for("platform.otel.shutdown")
  ] = () =>
    Promise.race([
      sdk.shutdown(),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000).unref()),
    ]).catch(() => {});

  await waitForAllMessagesAcknowledged();
}
