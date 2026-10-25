import { isKitUpdateSession, type KitUpdatePending } from "api-server-api";

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
  const session = sessions?.find((s) => isKitUpdateSession(s, pending));
  return session?.sessionId ?? null;
}
