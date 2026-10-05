import type { KitUpdatePending } from "api-server-api";
import { SessionType } from "api-server-api";

import { useAgentSessionQuery } from "../../sessions/api/queries.js";

const RECENT_CHATS = 5;

export function useKitUpdateSessionId(
  agentId: string,
  pending: KitUpdatePending | null,
): string | null {
  const { data: sessions } = useAgentSessionQuery(
    agentId,
    { categories: ["chats"], limit: RECENT_CHATS },
    { enabled: pending !== null },
  );
  if (!pending || !sessions) return null;
  const started = Date.parse(pending.startedAt);
  const session = sessions.find(
    (s) =>
      s.initialization === true &&
      s.type === SessionType.Regular &&
      Date.parse(s.createdAt) >= started,
  );
  return session?.sessionId ?? null;
}
