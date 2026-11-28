import type { ConnectionView } from "api-server-api";

import type { RowToolAccess } from "../components/catalog-connection-row.js";
import type { GrantDetails } from "../components/default-accounts-callout.js";
import { isDamConnection } from "../lib/dam-connection.js";

// UNIT_BOUNDARY_DESCRIPTION: what the platform Connection's row of one Agent says about how the Agent reaches the platform: as its owner, or as itself with a key of its own, and the Access button where the owner may change it. Every other row is left to its own access; a viewer who may not change it sees the line without the button.
export function useGrantRowScope(
  grants: ReadonlyMap<string, GrantDetails> | undefined,
  onEdit?: (connection: ConnectionView) => void,
): ((connection: ConnectionView) => RowToolAccess | undefined) | undefined {
  if (!grants) return undefined;
  return (connection) => {
    if (!isDamConnection(connection) || !grants.has(connection.id))
      return undefined;
    return {
      actsAsItself: grants.get(connection.id)?.scope !== undefined,
      ...(onEdit && {
        onEdit: () => onEdit(connection),
        editLabel: "Access",
      }),
    };
  };
}
