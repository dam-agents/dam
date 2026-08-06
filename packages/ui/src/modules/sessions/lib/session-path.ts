/**
 * The chat path for a session. Kept free of store and DOM imports so
 * node-environment unit tests can exercise it directly.
 */
import { SessionMode } from "api-server-api";

import { routeToPath } from "../../platform/lib/routes.js";

/** The chat path for what the user is currently looking at. A terminal session
 *  is deliberately dropped: it is a client-side PTY, not a resumable
 *  conversation, so its id would resolve to nothing on a reload — the URL then
 *  names the agent alone rather than a session that can't be re-opened. */
export function sessionPath(
  agentId: string,
  sessionId: string | null,
  sessionMode: SessionMode | null,
): string {
  const session =
    sessionId && sessionMode !== SessionMode.Terminal ? sessionId : undefined;
  return routeToPath({
    view: "chat",
    agent: agentId,
    ...(session ? { session } : {}),
  });
}
