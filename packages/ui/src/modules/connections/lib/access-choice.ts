import type { ConnectionView } from "api-server-api";

export type ConnectionAccess = "read-only" | "full";

export const READ_ONLY_LABEL = "Read only";

export const EDIT_ACCESS_TITLE = "Change access";

export const READ_ONLY_DESCRIPTION =
  "Agents search and read as you. Every tool that posts or changes something is refused.";

export const FULL_ACCESS_DESCRIPTION =
  "Agents also post and change things as you.";

export const FULL_ACCESS_WARNING =
  "Every agent you add this connection to can act as you, and so can anyone who can talk to that agent. Keep it read only unless an agent must act in your name.";

type Chosen = Pick<ConnectionView, "accessChoice" | "fullAccess">;

export function connectionAccess(connection: Chosen): ConnectionAccess | null {
  if (!connection.accessChoice) return null;
  return connection.fullAccess ? "full" : "read-only";
}

// UNIT_BOUNDARY_DESCRIPTION: what a connection that is read only or has full access, such as a Slack Account, lets an agent do, as the one line under its name; undefined for a connection that offers no such choice. Read only, the default, has no mark beside the name, so this line is where the row says it; full access also carries the danger mark.
export function accessReach(connection: Chosen): string | undefined {
  const access = connectionAccess(connection);
  if (access === null) return undefined;
  return access === "full"
    ? "Searches, reads and posts as you"
    : `${READ_ONLY_LABEL}: searches and reads as you, posts nothing`;
}
