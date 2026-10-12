import { skipToken, useQuery } from "@tanstack/react-query";
import type {
  AgentBackgroundWork,
  BackgroundWorkItemView,
  SessionBackgroundWork,
} from "api-server-api";

import { api } from "../../../api.js";
import { useAgentRunState } from "../../agents/api/queries.js";

const BACKGROUND_WORK_POLL_MS = 30_000;

const NO_WORK: readonly BackgroundWorkItemView[] = Object.freeze([]);
const NO_SESSIONS: readonly SessionBackgroundWork[] = Object.freeze([]);

const backgroundWorkKeys = {
  agent: (agentId: string | null) => ["background-work", agentId] as const,
};

function useBackgroundWorkQuery(
  agentId: string | null,
): AgentBackgroundWork | undefined {
  const awake = useAgentRunState(agentId) === "running";
  const { data } = useQuery({
    queryKey: backgroundWorkKeys.agent(agentId),
    queryFn:
      agentId && awake
        ? () => api.agents.backgroundWork.query({ id: agentId })
        : skipToken,
    refetchInterval: agentId && awake ? BACKGROUND_WORK_POLL_MS : false,
    retry: false,
  });
  return awake ? data : undefined;
}

export function useAgentBackgroundWork(
  agentId: string | null,
): readonly SessionBackgroundWork[] {
  return useBackgroundWorkQuery(agentId)?.sessions ?? NO_SESSIONS;
}

export function useSessionBackgroundWork(
  agentId: string | null,
  sessionId: string | null,
): readonly BackgroundWorkItemView[] {
  const sessions = useAgentBackgroundWork(agentId);
  if (!sessionId) return NO_WORK;
  return sessions.find((s) => s.sessionId === sessionId)?.items ?? NO_WORK;
}

export function useKeptWorkCount(agentId: string | null): number {
  const work = useBackgroundWorkQuery(agentId);
  if (!work) return 0;
  const keptTasks = work.sessions.reduce(
    (sum, session) => sum + session.items.length,
    0,
  );
  return keptTasks + work.keptProcesses;
}
