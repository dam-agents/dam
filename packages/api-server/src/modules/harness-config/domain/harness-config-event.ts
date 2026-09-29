import type { HarnessConfigEventPayload } from "agent-runtime-api";

export const harnessConfigEvent = (
  agentId: string,
  payload: HarnessConfigEventPayload,
  at: number,
  expiresAt: Date,
) => ({
  id: `harness-config:${agentId}:${at}`,
  kind: "harness-config" as const,
  payload,
  expiresAt,
});
