import type { CompareTo } from "agent-runtime-api";

export const changesKeys = {
  agent: (agentId: string) => ["changes", agentId] as const,
  list: (agentId: string, sessionId: string | null) =>
    [...changesKeys.agent(agentId), "list", sessionId] as const,
  diff: (agentId: string, path: string, compare: CompareTo) =>
    [...changesKeys.agent(agentId), "diff", path, compare] as const,
};
