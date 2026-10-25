import { providerTypeForTemplateId } from "api-server-api";

import {
  connectionLabel,
  type NamedConnection,
} from "../../connections/lib/connection-label.js";

export const OWNER_CONNECTIONS_SHOWN_MAX = 3;

export interface ConnectionList {
  list: string;
  names: readonly string[];
  more: number;
}

export interface OwnerConnectionsLine {
  text: string;
  names: readonly string[];
  more: number;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The names of an Agent's granted connections that
 * a tool call may act through, each with the account it acts as when that is
 * known ("GitHub as tomkis"). A model provider connection is left out: it
 * pays for the model, and it never acts on anything for the tool call.
 */
export function actingConnectionNames(
  connections: readonly (NamedConnection & { templateId: string })[],
): string[] {
  const names = connections
    .filter((c) => providerTypeForTemplateId(c.templateId) === null)
    .map(connectionLabel);
  return [...new Set(names)];
}

export function connectionList(names: readonly string[]): ConnectionList {
  const shown = names.slice(0, OWNER_CONNECTIONS_SHOWN_MAX);
  const more = names.length - shown.length;
  const list =
    more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
  return { list, names, more };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The line an Agent Editor reads on an approval in
 * a Shared Agent's chat: whose connections the action runs with, and which
 * ones. More than three names end in "and N more", and the caller shows all
 * of them in a tooltip. No names means no line.
 */
export function ownerConnectionsLine(
  owner: string,
  names: readonly string[],
): OwnerConnectionsLine | null {
  if (names.length === 0) return null;
  const { list, more } = connectionList(names);
  return { text: `Runs with ${owner}'s connections: ${list}.`, names, more };
}
