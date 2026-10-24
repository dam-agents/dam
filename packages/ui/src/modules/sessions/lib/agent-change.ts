import { toolNameOf, toolServerOf } from "agent-runtime-api";
import { PLATFORM_OUTBOUND_MCP_SERVER } from "api-server-api";

import type { ToolChip } from "../../../types.js";

export interface AgentChange {
  tab: "schedules" | "skills";
  kind: "schedule" | "skill";
  verb: "created" | "changed";
  id: string;
  name: string;
}

function outputText(chip: ToolChip): string {
  return (chip.content ?? [])
    .filter((part) => part.type === "content")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function outputObject(chip: ToolChip): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(outputText(chip));
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function scheduleChange(chip: ToolChip, tool: string): AgentChange | null {
  const verb = tool === "toggle_schedule" ? "changed" : "created";
  const output = outputObject(chip);
  const id = output?.id;
  if (typeof id !== "string" || id === "") return null;
  return {
    tab: "schedules",
    kind: "schedule",
    verb,
    id,
    name: typeof output?.name === "string" ? output.name : id,
  };
}

function skillChange(chip: ToolChip): AgentChange | null {
  const name = /^Installed (.+?) @/.exec(outputText(chip))?.[1]?.trim();
  if (!name) return null;
  return {
    tab: "skills",
    kind: "skill",
    verb: "created",
    id: name,
    name,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the Agent changed on itself, read from the
 * tool call the chat already shows: the platform's own MCP server answers with
 * the item's id and name, and no other signal in the conversation names the
 * item. A tool of a user's own MCP server that happens to share a name, a call
 * that failed or is still running, or an answer in a shape not read here gets no
 * card rather than a card nothing stands behind.
 */
export function agentChangeOf(chip: ToolChip): AgentChange | null {
  if (chip.status !== "completed") return null;
  if (toolServerOf(chip.title) !== PLATFORM_OUTBOUND_MCP_SERVER) return null;
  const tool = toolNameOf(chip.title);
  switch (tool) {
    case "create_schedule":
    case "schedule_once":
    case "toggle_schedule":
      return scheduleChange(chip, tool);
    case "install_skill":
      return skillChange(chip);
    default:
      return null;
  }
}
