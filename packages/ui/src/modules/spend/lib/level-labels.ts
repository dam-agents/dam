import { providerTypeForTemplateId } from "api-server-api";

import { providerName } from "../../providers/lib/provider-rows.js";
import { allAgentsOn, LEVEL_NAMES, thisAgentOn } from "./copy.js";
import type { Level } from "./limit-levels.js";

export function levelName(level: Level): string {
  switch (level.kind) {
    case "agent-connection":
      return level.connection?.name ?? "";
    case "all-connection":
      return allAgentsOn(level.connection?.name ?? "");
    default:
      return LEVEL_NAMES[level.kind];
  }
}

const LIST_ORDER: readonly Level["kind"][] = [
  "all-connection",
  "agent-connection",
  "agent",
  "ceiling",
  "total",
];

/** UNIT_BOUNDARY_DESCRIPTION: the order of a list of limits: each provider's for all agents, the agent's own on a provider, the operator's ceiling, and the total daily limit last. */
export function inListOrder(levels: readonly Level[]): Level[] {
  return [...levels].sort(
    (a, b) => LIST_ORDER.indexOf(a.kind) - LIST_ORDER.indexOf(b.kind),
  );
}

export function levelListName(level: Level): string {
  return level.kind === "agent-connection"
    ? thisAgentOn(level.connection?.name ?? "")
    : levelName(level);
}

export function connectionDisplayName(
  name: string,
  templateId: string,
): string {
  const type = templateId ? providerTypeForTemplateId(templateId) : null;
  return type ? providerName(type, templateId) : name;
}
