import type { CostReviewStarted } from "api-server-api";

import { useAgentSessionQuery } from "../../sessions/api/queries.js";

const RECENT_CHATS = 5;
const POLL_MS = 3_000;
const CLOCK_SKEW_MS = 120_000;

export function useCostReviewSessionId(
  started: CostReviewStarted | null,
): string | null {
  const { data: sessions } = useAgentSessionQuery(
    started?.agentId ?? null,
    { categories: ["chats"], limit: RECENT_CHATS },
    { enabled: started !== null, refetchInterval: POLL_MS },
  );
  if (!started) return null;
  const since = Date.parse(started.startedAt) - CLOCK_SKEW_MS;
  const session = sessions?.find(
    (s) => s.purpose === "cost-review" && Date.parse(s.createdAt) >= since,
  );
  return session?.sessionId ?? null;
}
