import type { SpendLimitView, SpendStatus } from "api-server-api";

export function agentLimitOf(
  status: SpendStatus,
  agentId: string,
): SpendLimitView | undefined {
  return status.limits.find(
    (limit) => limit.scope.kind === "agent" && limit.scope.agentId === agentId,
  );
}
