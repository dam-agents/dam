import { SessionMode } from "api-server-api";

import type { SessionView } from "../../../types.js";

export function isUnreadSession(
  session: SessionView,
  options?: { open?: boolean },
): boolean {
  if (options?.open) return false;
  if (session.mode === SessionMode.Terminal) return false;
  if (!session.seenAt || !session.updatedAt) return false;
  return Date.parse(session.updatedAt) > Date.parse(session.seenAt);
}
