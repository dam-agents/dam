import type { SpendStatus } from "api-server-api";

import { agentLimitOf } from "./agent-limit.js";

export interface NearerLimit {
  kind: "owner" | "ceiling";
  leftMicros: number;
}

export function nearerOwnerWideLimit(
  status: SpendStatus,
  agentId: string,
): NearerLimit | null {
  const agentLimit = agentLimitOf(status, agentId);
  const ownLimit = status.limits.find((limit) => limit.scope.kind === "owner");
  const candidates: NearerLimit[] = [
    ...(status.ceiling
      ? [
          {
            kind: "ceiling" as const,
            leftMicros: Math.max(
              0,
              status.ceiling.amountMicros - status.ceiling.spentMicros,
            ),
          },
        ]
      : []),
    ...(ownLimit
      ? [{ kind: "owner" as const, leftMicros: ownLimit.leftMicros }]
      : []),
  ];
  const nearest = candidates.reduce<NearerLimit | null>(
    (best, next) =>
      best === null || next.leftMicros < best.leftMicros ? next : best,
    null,
  );
  if (nearest === null) return null;
  if (agentLimit && agentLimit.leftMicros <= nearest.leftMicros) return null;
  return nearest;
}
