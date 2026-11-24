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

export const CHANGE_ACCESS_TITLE = "Change access";

export const ALLOW_ALL_WARNING =
  "Every agent you add this connection to can act as you, and so can anyone who can talk to that agent. Keep it read only unless an agent must act in your name.";

export const TOOL_MODE_SAVED_NOTE =
  "The choice holds for every agent that has this connection, from its next request.";

// UNIT_BOUNDARY_DESCRIPTION: the name and the one-line meaning of each tool mode, for the one choice per connection that the owner makes while the `mcp-tool-approval` feature is off. A Template that defaults to read only, such as a Slack Account, names its modes read only and "Can post as me"; a connection of any other Template, which only shows a mode while it is still left in needs approval, uses each mode's own name.
export function toolModeCopy(mode: ToolMode, ownNames: boolean): ToolModeCopy {
  switch (mode) {
    case "allow-all":
      return ownNames
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
        description: ownNames
          ? "Agents call only the tools that read. Every tool that posts or changes something is refused."
          : "Agents search and read as you. Every tool that posts or changes something is refused.",
      };
    case "needs-approval":
      return {
        label: NEEDS_APPROVAL_LABEL,
        description:
          "Agents call the tools that read at once. Every other tool waits until someone approves it in approvals.",
      };
  }
}

// UNIT_BOUNDARY_DESCRIPTION: the modes the owner picks from when a connection is made: read only or allow all, only on a Template that defaults to read only and only while the `mcp-tool-approval` feature is off. With the feature on, tool access belongs to each Agent's grant, so the connect form asks nothing. Empty where nothing is to be picked, so no picker shows.
export function pickableToolModes(
  toolAccess:
    Pick<ConnectionTemplateToolAccess, "modes" | "defaultMode"> | undefined,
  offered: boolean,
): readonly ToolMode[] {
  if (offered || !toolAccess || toolAccess.modes.length < 2) return [];
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

// UNIT_BOUNDARY_DESCRIPTION: the modes the owner picks from for an existing connection while the feature is off. A connection left in needs approval keeps that mode as its current choice beside every other mode it offers, so the owner can switch it away; the dialog saves only a mode other than the current one, so needs approval is never set again with the feature off. With the feature on there is no choice per connection.
export function connectionPickableToolModes(
  toolAccess: ConnectionToolAccessModes | undefined,
  offered: boolean,
): readonly ToolMode[] {
  if (offered) return [];
  if (toolAccess?.mode === "needs-approval")
    return SAFEST_FIRST.filter(
      (m) => m === "needs-approval" || toolAccess.modes.includes(m),
    );
  return pickableToolModes(toolAccess, false);
}

// UNIT_BOUNDARY_DESCRIPTION: whether a connection's modes go by their own names, the `ownNames` that toolModeCopy takes. Only a Template that defaults to read only keeps read only and "Can post as me".
export function ownToolModeNames(
  toolAccess: Pick<ConnectionToolAccess, "defaultMode"> | undefined,
): boolean {
  return toolAccess?.defaultMode !== "read-only";
}

type WithToolAccess = Pick<ConnectionView, "toolAccess">;

// UNIT_BOUNDARY_DESCRIPTION: the tool mode a connection's row and its sharing warning name, or null where they name none. Only while the feature is off, and only a connection whose Template defaults to read only or one still left in needs approval, names its mode; with the feature on each Agent's grant says it instead.
export function shownToolMode(
  connection: WithToolAccess,
  offered: boolean,
): ToolMode | null {
  const toolAccess = connection.toolAccess;
  if (connectionPickableToolModes(toolAccess, offered).length === 0)
    return null;
  return toolAccess?.mode ?? null;
}

// UNIT_BOUNDARY_DESCRIPTION: the line under a connection's name that says what its tool mode lets an agent do, in the Slack Account's words; undefined where the row names no mode.
export function toolModeReach(
  connection: WithToolAccess,
  offered: boolean,
): string | undefined {
  const mode = shownToolMode(connection, offered);
  if (mode === null) return undefined;
  switch (mode) {
    case "allow-all":
      return "Searches, reads and posts as you";
    case "read-only":
      return `${READ_ONLY_LABEL}: searches and reads as you, posts nothing`;
    case "needs-approval":
      return `${NEEDS_APPROVAL_LABEL}: the tools that read go through, every other tool waits for an answer`;
  }
}

export interface ToolModeMark {
  label: string;
  tone: "danger" | "warning";
}

// UNIT_BOUNDARY_DESCRIPTION: the mark beside a connection's name for its tool mode: "Can post as me" in danger where a Template that defaults to read only allows all, so posting as the owner always shows, and the warning mark for a connection still left in needs approval. Read only carries none: the line under the name says it.
export function toolModeMark(
  connection: WithToolAccess,
  offered: boolean,
): ToolModeMark | null {
  const toolAccess = connection.toolAccess;
  const mode = shownToolMode(connection, offered);
  if (mode === "needs-approval")
    return { label: NEEDS_APPROVAL_LABEL, tone: "warning" };
  if (mode === "allow-all" && toolAccess?.defaultMode === "read-only")
    return { label: POST_AS_ME_LABEL, tone: "danger" };
  return null;
}
