import type { SpendLimitView, SpendStatus } from "api-server-api";

export function agentLimitOf(
  status: SpendStatus,
  agentId: string,
): SpendLimitView | undefined {
  return status.limits.find(
    (limit) => limit.scope.kind === "agent" && limit.scope.agentId === agentId,
  );
}

export function agentLimitReached(
  status: SpendStatus | undefined,
  agentId: string,
): boolean {
  return (
    status?.limits.some(
      (limit) =>
        limit.scope.kind === "agent" &&
        limit.scope.agentId === agentId &&
        limit.state === "reached",
    ) ?? false
  );
}
