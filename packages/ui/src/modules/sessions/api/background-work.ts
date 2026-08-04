import { skipToken, useQuery } from "@tanstack/react-query";
import type {
  BackgroundWorkItemView,
  SessionBackgroundWork,
} from "api-server-api";

import { api } from "../../../api.js";
import { useAgentRunState } from "../../agents/api/queries.js";

const BACKGROUND_WORK_POLL_MS = 30_000;

const NO_WORK: readonly BackgroundWorkItemView[] = Object.freeze([]);
const NO_SESSIONS: readonly SessionBackgroundWork[] = Object.freeze([]);

export const backgroundWorkKeys = {
  agent: (agentId: string | null) => ["background-work", agentId] as const,
};

/** Background work the agent's sessions report (#2965). Polls only while the
 *  agent is `running` (the endpoint never wakes a pod); the same gate hides
 *  cached data once it stops. Consumers share one query. */
export function useAgentBackgroundWork(
  agentId: string | null,
): readonly SessionBackgroundWork[] {
  const awake = useAgentRunState(agentId) === "running";
  const { data } = useQuery({
    queryKey: backgroundWorkKeys.agent(agentId),
    queryFn:
      agentId && awake
        ? () => api.agents.backgroundWork.query({ id: agentId })
        : skipToken,
    refetchInterval: BACKGROUND_WORK_POLL_MS,
  });
  return awake ? (data ?? NO_SESSIONS) : NO_SESSIONS;
}

export function useSessionBackgroundWork(
  agentId: string | null,
  sessionId: string | null,
): readonly BackgroundWorkItemView[] {
  const sessions = useAgentBackgroundWork(agentId);
  if (!sessionId) return NO_WORK;
  return sessions.find((s) => s.sessionId === sessionId)?.items ?? NO_WORK;
}
