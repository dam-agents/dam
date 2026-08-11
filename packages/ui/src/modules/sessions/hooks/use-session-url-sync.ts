import type { SessionMode } from "api-server-api";
import { useEffect } from "react";

import { useStore } from "../../../store.js";
import { nextChatUrl, sessionPath } from "../lib/session-path.js";

function writeSessionPath(path: string, mode: "push" | "replace"): void {
  const url = nextChatUrl(window.location, path);
  if (url === null) return;
  if (mode === "push") history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

/**
 * Records a deliberate move to another session as its own history entry, so
 * back and forward walk the conversations the user opened. Call it before the
 * store changes — the sync effect below then finds the address bar already
 * right and leaves the new entry alone.
 *
 * Terminal sessions collapse onto the agent's own path — `sessionPath` drops an
 * id no reload could re-open — so switching between two of them writes nothing.
 */
export function pushSessionPath(
  agentId: string,
  sessionId: string | null,
  sessionMode: SessionMode | null,
): void {
  writeSessionPath(sessionPath(agentId, sessionId, sessionMode), "push");
}

/**
 * Keeps the address bar on the session the user has open, so the URL is always
 * a link to this conversation — copyable, reloadable, and the same shape a
 * channel reply points back at. It also covers the arrival of a session id the
 * user never navigated to: a fresh chat becomes linkable the moment the first
 * prompt creates its session.
 *
 * `replaceState`, not `pushState`: this reflects state the user did not
 * navigate to. The deliberate moves push their own entry — `openAgentSession`,
 * `selectAgent`, and `pushSessionPath` from the session list.
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
    writeSessionPath(sessionPath(agentId, sessionId, sessionMode), "replace");
  }, [view, agentId, sessionId, sessionMode, pendingResumeSessionId]);
}
