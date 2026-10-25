import type { AgentView } from "../../../types.js";

export const AGENT_DELETED_NOTICE = "This agent was deleted.";

export interface AgentDeparture {
  id: string;
  notice: string;
}

export function departedAgents(
  previous: readonly Pick<AgentView, "id" | "name" | "access">[] | undefined,
  next: readonly { id: string }[],
): AgentDeparture[] {
  const kept = new Set(next.map((a) => a.id));
  return (previous ?? [])
    .filter((a) => !kept.has(a.id))
    .map((a) => ({
      id: a.id,
      notice:
        a.access.role === "editor"
          ? `You no longer have access to ${a.name}.`
          : AGENT_DELETED_NOTICE,
    }));
}

export function agentFallback(
  inaccessible: boolean,
  deleted: boolean,
): "public" | "home" | null {
  if (!inaccessible) return null;
  return deleted ? "home" : "public";
}
