import type { HarnessConfigEventPayload } from "agent-runtime-api";

export const EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
