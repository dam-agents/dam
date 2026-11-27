import {
  toolModeSchema,
  type ConnectionToolAccess,
  type ToolMode,
} from "api-server-api";

export const TOOL_MODES = toolModeSchema.options;

export const TOOL_MODE_FLAG_HINT = `--mode takes ${TOOL_MODES.join(", ")}`;

export const LATER_GRANT_HELP =
  "\nAn agent granted the connection later gets the mode too, while tool access\n" +
  "per agent is off. With it on (an internal feature), a new agent starts\n" +
  "with the stricter of the mode and the safe start instead. The safe start\n" +
  "allows reads and blocks writes on a Slack Account, and allows reads and asks\n" +
  "before writes on any other MCP server. `dam connection grant` prints what\n" +
  "the agent starts with.\n";

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
      return "the mode lets every tool call pass, also the ones that post or change things as you, for anyone who can talk to an agent that has it";
    case "read-only":
      return "the mode lets only the tools that read pass, and refuses every other tool";
    case "needs-approval":
      return "the mode lets the tools that read pass at once, and every other tool call waits until someone approves it";
  }
}

// UNIT_BOUNDARY_DESCRIPTION: the note the CLI prints about the tool mode of an MCP Connection: what the mode lets an agent do, that an agent granted later can start stricter, and the command that changes it. None for a Connection that offers allow all alone, since there is nothing to choose.
export function toolModeNote(
  name: string,
  toolAccess: Pick<ConnectionToolAccess, "modes">,
  mode: ToolMode,
): string {
  if (toolAccess.modes.length < 2) return "";
  return (
    `note: ${name} is ${formatToolMode(mode)}: ${reachOf(mode)}; ` +
    "with tool access per agent on, an agent granted later can start stricter; " +
    `\`dam connection scope ${name} --mode <${toolAccess.modes.join("|")}>\` changes it\n`
  );
}
