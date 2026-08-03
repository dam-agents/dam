// Pure gate for the OTel bootstrap: telemetry turns on only when an OTLP
// endpoint is configured via the standard environment, and OTEL_SDK_DISABLED
// wins over everything. Kept dependency-free so the disabled path costs one
// env check and both entries (telemetry.ts, tests) can share it.
export function isOtelEnabled(
  env: Record<string, string | undefined>,
): boolean {
  if ((env.OTEL_SDK_DISABLED ?? "").trim().toLowerCase() === "true") {
    return false;
  }
  return [
    env.OTEL_EXPORTER_OTLP_ENDPOINT,
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
    env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
  ].some((endpoint) => Boolean(endpoint?.trim()));
}
