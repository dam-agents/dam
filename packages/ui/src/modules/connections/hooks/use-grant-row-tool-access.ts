import type { ConnectionView } from "api-server-api";

import type { RowToolAccess } from "../components/catalog-connection-row.js";
import type { GrantDetails } from "../components/default-accounts-callout.js";
import { accessSummary } from "../lib/grant-tool-access.js";
import { useToolApprovalOffered } from "./use-tool-approval-offered.js";

type RowToolAccessOf = (
  connection: ConnectionView,
) => RowToolAccess | undefined;

// UNIT_BOUNDARY_DESCRIPTION: what each row of one Agent's connections says about that Agent's tool access, and the Tool access button where the viewer may change it. Undefined while the `mcp-tool-approval` feature is off; a grant without tool access of its own, one of a connection whose requests the gateway does not read, says nothing.
export function useGrantRowToolAccess(
  grants: ReadonlyMap<string, GrantDetails> | undefined,
  onEdit?: (connection: ConnectionView) => void,
): RowToolAccessOf | undefined {
  const offered = useToolApprovalOffered();
  if (!offered || !grants) return undefined;
  return (connection) => {
    const access = grants.get(connection.id)?.toolAccess;
    if (!access) return undefined;
    return {
      summary: accessSummary(access, connection.toolAccess?.tools ?? null),
      ...(onEdit && { onEdit: () => onEdit(connection) }),
    };
  };
}
