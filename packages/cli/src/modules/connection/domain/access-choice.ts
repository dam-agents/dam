import type { ConnectionAccessChoice, ConnectionView } from "api-server-api";

export interface AccessScope {
  restricted: boolean;
  fullAccess?: true;
  readOnly?: true;
}

type Chosen = Pick<ConnectionView, "accessChoice" | "fullAccess">;

// UNIT_BOUNDARY_DESCRIPTION: the scope of a Connection whose owner chooses between read only and full access, such as a Slack Account, in the shape the GitHub scopes are listed in; undefined for a Connection that offers no such choice.
export function accessScopeOf(view: Chosen): AccessScope | undefined {
  if (!view.accessChoice) return undefined;
  return view.fullAccess
    ? { restricted: false, fullAccess: true }
    : { restricted: true, readOnly: true };
}

export function formatAccess(
  choice: ConnectionAccessChoice,
  fullAccess: boolean,
): string {
  return fullAccess ? `FULL ACCESS — ${choice.fullAccessLabel}` : "read only";
}

export function accessNote(
  name: string,
  choice: ConnectionAccessChoice,
  fullAccess: boolean,
): string {
  return fullAccess
    ? `note: ${name} has full access (${choice.fullAccessLabel}): an agent you grant it to can also change things as you, ` +
        `and so can anyone who can talk to that agent; \`dam connection scope ${name} --read-only\` limits it to reading\n`
    : `note: ${name} is read only: an agent you grant it to can search and read, and every other tool is refused; ` +
        `\`dam connection scope ${name} --full-access\` lifts the limit (${choice.fullAccessLabel})\n`;
}
