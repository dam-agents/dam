import { useEffect } from "react";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import { publicAgentPath, routeToPath } from "../../platform/lib/routes.js";
import { AGENT_DELETED_NOTICE, agentFallback } from "../lib/deleted-agent.js";

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
 * A deleted agent reads as unreadable too — `agents.get` answers NOT_FOUND for
 * a deleted agent and for someone else's alike — so an agent this tab deleted,
 * or saw vanish from its list, is remembered and sends the visitor home
 * instead. Otherwise deleting your own agent would throw you out of the app
 * onto its public page, and a tab left open on an agent deleted elsewhere
 * would wait on it forever. Home also replaces the entry, for the same Back
 * reason. An Agent Editor who lost access, or left, goes home the same way,
 * told so by name, never sent to the owner's public page.
 *
 * The redirect marks itself with `from=app`, so the page, which cannot tell who
 * is asking, still knows this visitor is signed in and words itself for them.
 *
 * It reports whether it is leaving, so the caller can cover its own surface for
 * as long as the navigation takes.
 */
export function usePublicAgentFallback(
  agentId: string | null,
  inaccessible: boolean,
): boolean {
  const departure = useStore((s) =>
    agentId ? s.departedAgents.get(agentId) : undefined,
  );
  const fallback = agentFallback(
    agentId !== null && inaccessible,
    departure !== undefined,
  );

  useEffect(() => {
    if (fallback === "public" && agentId !== null)
      window.location.replace(`${publicAgentPath(agentId)}?from=app`);
    if (fallback === "home") {
      history.replaceState(null, "", routeToPath({ view: "home" }));
      useStore.getState().hydrateRoute();
      emitToast({ kind: "info", message: departure ?? AGENT_DELETED_NOTICE });
    }
  }, [fallback, agentId, departure]);

  return fallback !== null;
}
