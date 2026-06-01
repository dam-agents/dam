import { skipToken, useQuery } from "@tanstack/react-query";
import { SessionType } from "api-server-api";

import { listAgentSessions } from "./acp-session-ops.js";

export const acpSessionsKeys = {
  all: ["acp-sessions"] as const,
  agentLists: (agentId: string | null) =>
    [...acpSessionsKeys.all, agentId] as const,
  list: (agentId: string | null, includeChannel: boolean) =>
    [...acpSessionsKeys.agentLists(agentId), { includeChannel }] as const,
};

/**
 * Sessions list, read straight off the agent over ACP `session/list` (ADR-055)
 * and decoded from `_meta.platform`. Schedule sessions are excluded from the
 * main list; channel sessions are included only when asked. Pass
 * `enabled: false` (e.g. while the agent is waking) to keep the query in cache
 * without firing requests.
 *
 * `refetchOnMount: "always"` because the title is harness-set after the first
 * turn — a returning user must see the updated title without a manual refresh.
 */
export function useAcpSessions(
  agentId: string | null,
  includeChannel: boolean,
  options?: { enabled?: boolean },
) {
  const live = !!agentId && (options?.enabled ?? true);
  return useQuery({
    queryKey: acpSessionsKeys.list(agentId, includeChannel),
    queryFn: live
      ? async () => {
          const sessions = await listAgentSessions(agentId);
          const allowed: string[] = [SessionType.Regular];
          if (includeChannel)
            allowed.push(SessionType.ChannelSlack, SessionType.ChannelTelegram);
          return sessions.filter((s) => allowed.includes(s.type));
        }
      : skipToken,
    refetchOnMount: "always",
    staleTime: 5_000,
    meta: { errorToast: "Couldn't refresh session list" },
  });
}
