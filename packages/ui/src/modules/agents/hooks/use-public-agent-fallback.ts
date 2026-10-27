import { useEffect } from "react";

import { useStore } from "../../../store.js";
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
 *
 * An agent this tab just deleted reads as unreadable too — `agents.get` answers
 * NOT_FOUND for a deleted agent and for someone else's alike — so a delete the
 * user started is remembered and never redirects. Otherwise deleting your own
 * agent would throw you out of the app onto its public page.
 *
 * It reports whether it is leaving, so the caller can cover its own surface for
 * as long as the navigation takes.
 */
export function usePublicAgentFallback(
  agentId: string | null,
  inaccessible: boolean,
): boolean {
  const deleted = useStore((s) =>
    agentId ? s.deletedAgents.has(agentId) : false,
  );
  const target =
    agentId !== null && inaccessible && !deleted
      ? publicAgentPath(agentId)
      : null;

  useEffect(() => {
    if (target !== null) window.location.replace(target);
  }, [target]);

  return target !== null;
}
