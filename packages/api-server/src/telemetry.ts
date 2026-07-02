// OpenTelemetry bootstrap, loaded via `node --import ./dist/telemetry.js
// dist/index.js` (see Dockerfile). It must run before the app bundle
// evaluates: ESM instrumentation rewires imports through an
// import-in-the-middle loader hook that only affects modules imported after
// registration.
//
// MUST NOT be imported by index.ts: this file is its own tsup bundle, and
// importing it from the app would evaluate a second copy with its own SDK
// and hook channel. The app reaches the SDK only through the globalThis
// shutdown hook below and the @opentelemetry/api globals.
//
// Everything OTel is behind the gate and dynamically imported, so a
// deployment without an OTLP endpoint pays one env check and loads nothing.
import { isOtelEnabled } from "./telemetry-gate.js";

if (isOtelEnabled(process.env)) {
  const { register } = await import("node:module");
  const { createAddHookMessageChannel } = await import("import-in-the-middle");

  // The message channel lets instrumentations add their hook targets after
  // the loader is registered, and lets us block until the loader thread has
  // acknowledged them. This must be the same import-in-the-middle instance
  // @opentelemetry/instrumentation resolves (module-level channel state), so
  // import-in-the-middle is a direct dependency and stays external in tsup.
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
    // service.name comes from OTEL_SERVICE_NAME (set by the chart).
    resource: resources.resourceFromAttributes({
      "service.version": process.env.PLATFORM_APP_VERSION ?? "0.0.0",
    }),
    // The OTLP proto exporters read OTEL_EXPORTER_OTLP_* themselves and
    // append the per-signal path — no endpoint plumbing here.
    traceExporter: new OTLPTraceExporter(),
    metricReaders: [
      new metrics.PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
      }),
    ],
    logRecordProcessors: [
      new logs.BatchLogRecordProcessor(new OTLPLogExporter()),
    ],
    // Curated per-library instrumentation — exactly the libraries this
    // process uses — rather than the auto-instrumentations meta-package
    // and its ~90 mostly-inapplicable dependencies.
    instrumentations: [
      new HttpInstrumentation({
        // Kubelet probes hammer /api/health; not worth a span each.
        ignoreIncomingRequestHook: (req) =>
          (req.url ?? "").split("?", 1)[0] === "/api/health",
      }),
      new UndiciInstrumentation(),
      new GrpcInstrumentation(),
      new IORedisInstrumentation(),
      // Defaults do both jobs: trace_id/span_id fields on the stdout
      // stream, and record export through the Logs SDK.
      new PinoInstrumentation(),
      new PgInstrumentation(),
      new RuntimeNodeInstrumentation(),
    ],
  });
  sdk.start();

  // index.ts awaits this (via Symbol lookup, never an import) right before
  // its process.exit, so buffered telemetry flushes on SIGTERM. Capped: an
  // unreachable collector must not eat the pod's termination grace period.
  (globalThis as Record<symbol, unknown>)[
    Symbol.for("platform.otel.shutdown")
  ] = () =>
    Promise.race([
      sdk.shutdown(),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000).unref()),
    ]).catch(() => {});

  // Hold the app back until the loader thread has wired every hook;
  // otherwise early imports (pino, ioredis) could slip through unpatched.
  await waitForAllMessagesAcknowledged();
}
