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
  session: (agentId: string | null, sessionId: string | null) =>
    [...acpSessionsKeys.agent(agentId), "session", sessionId] as const,
};
