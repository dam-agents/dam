import type { AgentAccess } from "api-server-api";

import { type ConnectionList, connectionList } from "./owner-connections.js";

export const EDITORS_TOOLTIP_MAX = 5;

const EDITORS_CAN =
  "Editors can use and delete every session with this agent, yours included. They can read and change its files and environment variables, change its set-up, including its spend limits, and approve actions it takes with your connections";

const EDITORS_SPEND = "Their use counts toward your own spend limits.";

export const EDITORS_WARNING = `${EDITORS_CAN}. ${EDITORS_SPEND}`;

export interface EditorsWarning {
  text: string;
  connections: ConnectionList | null;
}

export function editorsWarning(
  connectionNames: readonly string[],
): EditorsWarning {
  if (connectionNames.length === 0)
    return { text: EDITORS_WARNING, connections: null };
  const connections = connectionList(connectionNames);
  return {
    text: `${EDITORS_CAN}: ${connections.list}. ${EDITORS_SPEND}`,
    connections,
  };
}

const editorCount = (count: number) =>
  `${count} editor${count === 1 ? "" : "s"}`;

export function isSharedAgent(agent: { access: AgentAccess }): boolean {
  return agent.access.editors.length > 0;
}

export function isOwnAgent(agent: { access: AgentAccess }): boolean {
  return agent.access.role === "owner";
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
