import { useEffect } from "react";

import { useStore } from "../../../store.js";
import type { ConnectionState } from "./use-acp-connection.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a permission request belongs to the ACP channel that asked it. A channel that comes back live reconciles the chat's pending requests: one whose channel is gone can never carry an answer, and the runtime reissues only the requests it still holds, so an ended one would otherwise block the composer for good. A request the runtime still holds comes back reissued on the new channel, and the reconciliation keeps it.
 */
export function useReconciledPermissions(
  connectionState: ConnectionState,
): void {
  const dropClosedChannels = useStore(
    (s) => s.dropPermissionsFromClosedChannels,
  );
  useEffect(() => {
    if (connectionState === "live") dropClosedChannels();
  }, [connectionState, dropClosedChannels]);
}
