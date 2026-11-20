import {
  toolModeSchema,
  type ConnectionToolAccess,
  type ToolMode,
} from "api-server-api";

export const TOOL_MODES = toolModeSchema.options;

export const TOOL_MODE_FLAG_HINT = `--mode takes ${TOOL_MODES.join(", ")}`;

export function parseToolMode(raw: string): ToolMode | null {
  const parsed = toolModeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function formatToolMode(mode: ToolMode): string {
  switch (mode) {
    case "allow-all":
      return "allow all";
    case "read-only":
      return "read only";
    case "needs-approval":
      return "needs approval";
  }
}

function reachOf(mode: ToolMode): string {
  switch (mode) {
    case "allow-all":
      return "an agent you grant it to calls every tool, also the ones that post or change things as you, and so can anyone who can talk to that agent";
    case "read-only":
      return "an agent you grant it to calls only the tools that read, and every other tool is refused";
    case "needs-approval":
      return "every tool call an agent makes waits until someone approves it, read tools too";
  }
}

// UNIT_BOUNDARY_DESCRIPTION: the note the CLI prints about the tool mode of an MCP Connection: what an agent can do in that mode, and the command that changes it. None for a Connection that offers allow all alone, since there is nothing to choose.
export function toolModeNote(
  name: string,
  toolAccess: Pick<ConnectionToolAccess, "modes">,
  mode: ToolMode,
): string {
  if (toolAccess.modes.length < 2) return "";
  return (
    `note: ${name} is ${formatToolMode(mode)}: ${reachOf(mode)}; ` +
    `\`dam connection scope ${name} --mode <${toolAccess.modes.join("|")}>\` changes it\n`
  );
}
