import { useEffect } from "react";

import { publicAgentPath } from "../../platform/lib/routes.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Sends a signed-in visitor who cannot read an agent
 * to the Public Agent Page, so a link shared in Slack never ends on an error
 * state. It exists as its own module because two routes need it and both must
 * leave the SPA the same way: main.tsx picks the public entry from the pathname
 * before App mounts, so a history push would keep rendering the authenticated
 * tree and never show the page. The navigation replaces the current entry
 * instead of adding one, or Back would land on the unreadable URL and redirect
 * forward again.
 */
export function usePublicAgentFallback(
  agentId: string | null,
  inaccessible: boolean,
): void {
  useEffect(() => {
    if (agentId !== null && inaccessible) {
      window.location.replace(publicAgentPath(agentId));
    }
  }, [agentId, inaccessible]);
}
