import type { GatewayRestartImpact } from "api-server-api";

export function gatewayRestartNotice(impact: GatewayRestartImpact): string {
  const clauses = [
    impact.promoted.length > 0 &&
      `start inspecting requests to ${impact.promoted.join(", ")}`,
    impact.demoted.length > 0 &&
      `stop inspecting requests to ${impact.demoted.join(", ")}`,
  ].filter((c): c is string => c !== false);
  return (
    `The network gateway will restart (~5–15s) to ${clauses.join(" and ")}.\n` +
    "The sandbox keeps running — its outbound requests are briefly interrupted.\n"
  );
}
