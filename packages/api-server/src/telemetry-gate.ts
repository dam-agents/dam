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
