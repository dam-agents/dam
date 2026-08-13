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

/** The parts of `window.location` a chat URL is built from. */
export interface ChatLocation {
  pathname: string;
  search: string;
  hash: string;
}

/** The URL to write for `path`, or null when that path is already showing.
 *  Null is what keeps a history entry from being stacked on itself — switching
 *  between two terminals, or re-picking the open session, both resolve to the
 *  path already in the address bar, and an entry there would be a back step
 *  that changes nothing. Query and hash ride along: they belong to the tab,
 *  not to the session. */
export function nextChatUrl(
  location: ChatLocation,
  path: string,
): string | null {
  if (location.pathname === path) return null;
  return path + location.search + location.hash;
}
