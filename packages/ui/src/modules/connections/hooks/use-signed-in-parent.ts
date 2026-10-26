import type { ConnectionView } from "api-server-api";
import { useEffect, useState } from "react";

import { useAppConnections } from "../api/queries.js";
import { awaitingFirstConnection } from "../lib/connection-hierarchy.js";

// UNIT_BOUNDARY_DESCRIPTION: after an OAuth sign-in returns, decides once, when the connection list has loaded, whether to ask what the first connection made from it should reach: only for a GitHub sign-in with no connection made from it yet. Any other answer, such as the re-authentication of a sign-in that already has connections, calls onSkip so the caller drops the returned id, and the question never comes back later on its own when the sign-in's last connection is deleted.
export function useSignedInParent(
  connectionId: string,
  onSkip: () => void,
): ConnectionView | null {
  const { data: connections } = useAppConnections();
  const [decided, setDecided] = useState<ConnectionView | null | undefined>(
    undefined,
  );
  if (decided === undefined && connections)
    setDecided(awaitingFirstConnection(connectionId, connections));
  const skipped = decided === null;
  useEffect(() => {
    if (skipped) onSkip();
  }, [skipped, onSkip]);
  return decided ?? null;
}
