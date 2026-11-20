import type {
  ConnectionTemplateToolAccess,
  ConnectionToolAccess,
  ConnectionView,
  ToolMode,
} from "api-server-api";

export interface ToolModeCopy {
  label: string;
  description: string;
}

const READ_ONLY_LABEL = "Read only";

const POST_AS_ME_LABEL = "Can post as me";

const NEEDS_APPROVAL_LABEL = "Needs approval";

export const ALLOW_ALL_WARNING =
  "Every agent you add this connection to can act as you, and so can anyone who can talk to that agent. Keep it read only unless an agent must act in your name.";

export const TOOL_MODE_SAVED_NOTE =
  "The choice holds for every agent that has this connection, from its next request.";

// UNIT_BOUNDARY_DESCRIPTION: the name and the one-line meaning of each tool mode. While the `mcp-tool-approval` feature is off, a Template that defaults to read only, such as a Slack Account, offers only read only or "Can post as me", the names it had before tool modes; with the feature on every mode has its own name.
export function toolModeCopy(mode: ToolMode, offered: boolean): ToolModeCopy {
  switch (mode) {
    case "allow-all":
      return offered
        ? {
            label: "Allow all",
            description:
              "Agents call every tool the server offers, also the ones that post or change things as you.",
          }
        : {
            label: POST_AS_ME_LABEL,
            description: "Agents also post and change things as you.",
          };
    case "read-only":
      return {
        label: READ_ONLY_LABEL,
        description: offered
          ? "Agents call only the tools that read. Every tool that posts or changes something is refused."
          : "Agents search and read as you. Every tool that posts or changes something is refused.",
      };
    case "needs-approval":
      return {
        label: NEEDS_APPROVAL_LABEL,
        description:
          "Every tool call waits until someone approves it in approvals, the tools that read too.",
      };
  }
}

export function toolAccessTitle(offered: boolean): string {
  return offered ? "Tool access" : "Change access";
}

// UNIT_BOUNDARY_DESCRIPTION: the modes the owner picks from, safest first. With the feature on, every mode the Connection or Template offers; with it off, only read only and allow all, and only on a Template that defaults to read only. Empty where nothing is to be picked, so no picker shows.
export function pickableToolModes(
  toolAccess:
    Pick<ConnectionTemplateToolAccess, "modes" | "defaultMode"> | undefined,
  offered: boolean,
): readonly ToolMode[] {
  if (!toolAccess || toolAccess.modes.length < 2) return [];
  if (offered) return SAFEST_FIRST.filter((m) => toolAccess.modes.includes(m));
  return toolAccess.defaultMode === "read-only"
    ? ["read-only", "allow-all"]
    : [];
}

const SAFEST_FIRST: readonly ToolMode[] = [
  "read-only",
  "needs-approval",
  "allow-all",
];

type ConnectionToolAccessModes = Pick<
  ConnectionToolAccess,
  "mode" | "modes" | "defaultMode"
>;

// UNIT_BOUNDARY_DESCRIPTION: the modes the owner picks from for an existing connection. A connection left in needs approval while the feature is off keeps that mode as its current choice beside every other mode it offers, so the owner can switch it away; the dialog saves only a mode other than the current one, so needs approval is never set again with the feature off.
export function connectionPickableToolModes(
  toolAccess: ConnectionToolAccessModes | undefined,
  offered: boolean,
): readonly ToolMode[] {
  if (!offered && toolAccess?.mode === "needs-approval")
    return SAFEST_FIRST.filter(
      (m) => m === "needs-approval" || toolAccess.modes.includes(m),
    );
  return pickableToolModes(toolAccess, offered);
}

// UNIT_BOUNDARY_DESCRIPTION: whether a connection's modes go by their own names, the `offered` that toolModeCopy takes. Only a Template that defaults to read only keeps its old names while the feature is off.
export function ownToolModeNames(
  toolAccess: Pick<ConnectionToolAccess, "defaultMode"> | undefined,
  offered: boolean,
): boolean {
  return offered || toolAccess?.defaultMode !== "read-only";
}

type WithToolAccess = Pick<ConnectionView, "toolAccess">;

// UNIT_BOUNDARY_DESCRIPTION: the tool mode a connection's row and its sharing warning name, or null where they name none: a connection with nothing to pick, and, while the feature is off, every connection but one whose Template defaults to read only or one still left in needs approval.
export function shownToolMode(
  connection: WithToolAccess,
  offered: boolean,
): ToolMode | null {
  const toolAccess = connection.toolAccess;
  if (connectionPickableToolModes(toolAccess, offered).length === 0)
    return null;
  return toolAccess?.mode ?? null;
}

// UNIT_BOUNDARY_DESCRIPTION: the line under a connection's name that says what its tool mode lets an agent do; undefined where the row names no mode. While the feature is off it keeps the Slack Account's wording.
export function toolModeReach(
  connection: WithToolAccess,
  offered: boolean,
): string | undefined {
  const mode = shownToolMode(connection, offered);
  if (mode === null) return undefined;
  switch (mode) {
    case "allow-all":
      return offered
        ? "Allow all: every tool call goes through"
        : "Searches, reads and posts as you";
    case "read-only":
      return offered
        ? `${READ_ONLY_LABEL}: only the tools that read, every other tool refused`
        : `${READ_ONLY_LABEL}: searches and reads as you, posts nothing`;
    case "needs-approval":
      return `${NEEDS_APPROVAL_LABEL}: every tool call waits for an answer`;
  }
}

export interface ToolModeMark {
  label: string;
  tone: "danger" | "warning";
}

// UNIT_BOUNDARY_DESCRIPTION: the mark beside a connection's name for its tool mode: the danger mark where it allows all on a Template that defaults to read only, so posting as the owner always shows, and the warning mark for needs approval. Allow all on a Template whose default it is, and read only, carry none: the line under the name says them.
export function toolModeMark(
  connection: WithToolAccess,
  offered: boolean,
): ToolModeMark | null {
  const toolAccess = connection.toolAccess;
  const mode = shownToolMode(connection, offered);
  if (mode === "needs-approval")
    return { label: NEEDS_APPROVAL_LABEL, tone: "warning" };
  if (mode === "allow-all" && toolAccess?.defaultMode === "read-only")
    return { label: toolModeCopy("allow-all", offered).label, tone: "danger" };
  return null;
}
