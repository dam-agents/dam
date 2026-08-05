import { useEffect } from "react";

import { useStore } from "../../../store.js";
import { sessionPath } from "../lib/session-path.js";

/**
 * Keeps the address bar on the session the user has open, so the URL is always
 * a link to this conversation — copyable, reloadable, and the same shape a
 * channel reply points back at.
 *
 * `replaceState`, not `pushState`: switching sessions inside one agent's chat is
 * changing what you look at, not a navigation step, and back should still leave
 * chat rather than walk every session visited on the way. Deliberate entries
 * (`openAgentSession`, `selectAgent`) push their own.
 */
export function useSessionUrlSync(agentId: string | null): void {
  const view = useStore((s) => s.view);
  const sessionId = useStore((s) => s.sessionId);
  const sessionMode = useStore((s) => s.sessionMode);
  const pendingResumeSessionId = useStore((s) => s.pendingResumeSessionId);

  useEffect(() => {
    // Only the plain chat route carries a session; a knowledge base's page has
    // its own single-segment route.
    if (view !== "chat" || !agentId) return;
    // A queued resume already named its session in the URL (a followed link, a
    // back/forward step, a deep link from elsewhere in the app) and hasn't
    // opened it yet. Writing the not-yet-replaced session over that would erase
    // the very session about to open.
    if (pendingResumeSessionId) return;
    const path = sessionPath(agentId, sessionId, sessionMode);
    if (window.location.pathname === path) return;
    history.replaceState(
      null,
      "",
      path + window.location.search + window.location.hash,
    );
  }, [view, agentId, sessionId, sessionMode, pendingResumeSessionId]);
}
