import { providerTypeForTemplateId } from "api-server-api";

import type { SettingsTab } from "../../platform/lib/routes.js";
import type { SandboxSection } from "../../platform/lib/routes.js";
import { providerName } from "../../providers/lib/provider-rows.js";
import {
  allAgentsOn,
  LEVEL_NAMES,
  LEVEL_SCOPES,
  THIS_AGENT,
  thisAgentOn,
} from "./copy.js";
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
  "total",
  "all-connection",
  "agent-connection",
  "ceiling",
  "agent",
];

/** UNIT_BOUNDARY_DESCRIPTION: the order of a list of limits: the total first, then each provider's for all agents, the agent's own on a provider, and the operator's ceiling last. */
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

export function levelScope(level: Level): string | null {
  switch (level.kind) {
    case "agent-connection":
      return THIS_AGENT;
    case "all-connection":
      return null;
    default:
      return LEVEL_SCOPES[level.kind];
  }
}

export type LevelPlace =
  | { kind: "settings"; tab: SettingsTab; label: string }
  | { kind: "agent"; section: SandboxSection; label: string }
  | null;

export function levelPlace(level: Level): LevelPlace {
  switch (level.kind) {
    case "agent-connection":
      return { kind: "agent", section: "providers", label: "Providers" };
    case "all-connection":
      return {
        kind: "settings",
        tab: "providers",
        label: "Settings › Providers",
      };
    case "agent":
      return { kind: "agent", section: "usage", label: "Usage" };
    case "total":
      return { kind: "settings", tab: "usage", label: "Settings › Usage" };
    case "ceiling":
      return null;
  }
}

export function connectionDisplayName(
  name: string,
  templateId: string,
): string {
  const type = templateId ? providerTypeForTemplateId(templateId) : null;
  return type ? providerName(type, templateId) : name;
}
