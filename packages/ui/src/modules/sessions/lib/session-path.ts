import { SessionMode } from "api-server-api";

import { routeToPath } from "../../platform/lib/routes.js";

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

export interface ChatLocation {
  pathname: string;
  search: string;
  hash: string;
}

export function nextChatUrl(
  location: ChatLocation,
  path: string,
): string | null {
  if (location.pathname === path) return null;
  return path + location.search + location.hash;
}
