import type { SessionListQuery } from "agent-runtime-api";
import { SESSION_CATEGORIES, type SessionCategory } from "api-server-api";

function inCanonicalOrder(
  categories: readonly SessionCategory[],
): SessionCategory[] {
  return SESSION_CATEGORIES.filter((c) => categories.includes(c));
}

export const acpSessionsKeys = {
  all: ["acp-sessions"] as const,
  agent: (agentId: string | null) => [...acpSessionsKeys.all, agentId] as const,
  pages: (agentId: string | null) =>
    [...acpSessionsKeys.agent(agentId), "pages"] as const,
  pagesOf: (agentId: string | null, categories: readonly SessionCategory[]) =>
    [...acpSessionsKeys.pages(agentId), inCanonicalOrder(categories)] as const,
  query: (agentId: string | null, query: SessionListQuery) =>
    [
      ...acpSessionsKeys.agent(agentId),
      "query",
      query.categories
        ? { ...query, categories: inCanonicalOrder(query.categories) }
        : query,
    ] as const,
  sessions: (agentId: string | null) =>
    [...acpSessionsKeys.agent(agentId), "session"] as const,
  session: (agentId: string | null, sessionId: string | null) =>
    [...acpSessionsKeys.sessions(agentId), sessionId] as const,
  history: (agentId: string, sessionId: string) =>
    [...acpSessionsKeys.agent(agentId), "history", sessionId] as const,
  agentIdOf: (queryKey: readonly unknown[]): string | null => {
    const id = queryKey[acpSessionsKeys.all.length];
    return queryKey[0] === acpSessionsKeys.all[0] && typeof id === "string"
      ? id
      : null;
  },
};
