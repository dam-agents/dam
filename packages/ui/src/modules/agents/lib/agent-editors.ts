import type { AgentAccess } from "api-server-api";

export const EDITORS_TOOLTIP_MAX = 5;

export const EDITORS_WARNING =
  "Editors will see every session with this agent, past and future, and everything it can read, including its environment variables and files. They can change its set-up, including its spend limits, and approve actions it takes with your connections. It keeps running on your budget, so your own spend limit still caps it.";

const editorCount = (count: number) =>
  `${count} editor${count === 1 ? "" : "s"}`;

export function isSharedAgent(agent: { access: AgentAccess }): boolean {
  return agent.access.editors.length > 0;
}

export function editorsTooltip(editors: readonly string[]): {
  title: string;
  shown: readonly string[];
  more: number;
} {
  return {
    title: `Shared with ${editorCount(editors.length)}`,
    shown: editors.slice(0, EDITORS_TOOLTIP_MAX),
    more: Math.max(0, editors.length - EDITORS_TOOLTIP_MAX),
  };
}

export function peopleSummary(access: AgentAccess): string {
  const count = access.editors.length;
  if (access.role === "editor") return `Owner + ${editorCount(count)}`;
  return count === 0 ? "Only you" : editorCount(count);
}

export function ownerLine(ownerEmail: string | null): string {
  return `Owned by ${ownerEmail ?? "a former user"} · you're an editor`;
}
