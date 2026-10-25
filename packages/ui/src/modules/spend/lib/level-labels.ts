import { providerTypeForTemplateId } from "api-server-api";

import type { SettingsTab } from "../../platform/lib/routes.js";
import type { SandboxSection } from "../../platform/lib/routes.js";
import { providerName } from "../../providers/lib/provider-rows.js";
import {
  allAgentsOn,
  LEVEL_NAMES,
  LEVEL_SCOPES,
  LEVEL_SHORT,
  THIS_AGENT,
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

export function levelShort(level: Level, onProviderPage: boolean): string {
  switch (level.kind) {
    case "agent-connection":
      return onProviderPage
        ? "This agent's limit"
        : (level.connection?.name ?? "");
    case "all-connection":
      return onProviderPage
        ? "The limit for all agents"
        : allAgentsOn(level.connection?.name ?? "");
    default:
      return LEVEL_SHORT[level.kind];
  }
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
      return { kind: "agent", section: "models", label: "Models" };
    case "all-connection":
      return {
        kind: "settings",
        tab: "providers",
        label: "Settings › Providers",
      };
    case "agent":
      return { kind: "agent", section: "models", label: "Models" };
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
