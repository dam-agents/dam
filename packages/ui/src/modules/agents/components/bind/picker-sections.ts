import type { AgentView } from "../../../../types.js";

export const MOST_RECENT_COUNT = 3;

export interface PickerSection {
  label: string;
  agents: readonly AgentView[];
}

export function matchesAgentQuery(agent: AgentView, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    agent.name.toLowerCase().includes(needle) ||
    (agent.description ?? "").toLowerCase().includes(needle)
  );
}

export function pickerSections(
  agents: readonly AgentView[],
  query: string,
): PickerSection[] {
  const newestFirst = agents
    .filter((agent) => matchesAgentQuery(agent, query))
    .sort(byCreatedAtDesc);
  return [
    { label: "Most recent", agents: newestFirst.slice(0, MOST_RECENT_COUNT) },
    {
      label: "A – Z",
      agents: newestFirst.slice(MOST_RECENT_COUNT).sort(byName),
    },
  ].filter((section) => section.agents.length > 0);
}

function byCreatedAtDesc(a: AgentView, b: AgentView): number {
  const left = a.createdAt ?? "";
  const right = b.createdAt ?? "";
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

function byName(a: AgentView, b: AgentView): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}
