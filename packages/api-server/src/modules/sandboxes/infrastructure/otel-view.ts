import type { EnvoyOTelView } from "../domain/envoy-bootstrap.js";

export interface OtelConfig {
  otelExporterEndpoint?: string | undefined;
  otelExporterProtocol: string;
  otelTracesSamplerArg: number;
  telemetryCollectorHost: string;
  telemetryCollectorPort: number;
}

const GATEWAY_SERVICE_NAME = "platform-agent-gateway";

/**
 * What the gateway exports about itself. Everything is off when no exporter is
 * configured: a gateway that cannot reach a collector must not spend the
 * agent's egress budget retrying, and its access logs would otherwise be the
 * loudest thing on the node.
 */
export function gatewayOtelView(
  agentId: string,
  config: OtelConfig,
): EnvoyOTelView {
  const endpoint = config.otelExporterEndpoint ?? "";
  const enabled = Boolean(endpoint);
  const grpc = config.otelExporterProtocol === "grpc";
  const url = enabled ? safeUrl(endpoint) : null;
  return {
    traces: enabled,
    metrics: enabled,
    accessLogs: enabled,
    collector: enabled,
    grpc,
    secure: url?.protocol === "https:",
    collectorHost: url?.hostname ?? "",
    collectorPort: url ? Number(url.port || (grpc ? 4317 : 4318)) : 0,
    tracesUri: url ? `${trimSlash(endpoint)}/v1/traces` : "",
    logsUri: url ? `${trimSlash(endpoint)}/v1/logs` : "",
    serviceName: GATEWAY_SERVICE_NAME,
    agentId,
    samplingPercent: config.otelTracesSamplerArg * 100,
  };
}

const trimSlash = (s: string) => s.replace(/\/+$/, "");

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
