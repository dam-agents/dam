import type { AttentionItem } from "api-server-api";

import {
  type ActivityFilters,
  channelTypeOfSession,
} from "./activity-filter.js";
import { isUnreadAttention } from "./unread.js";

export interface ActivitySession {
  id: string;
  session: AttentionItem;
  at: string;
  working: boolean;
  unread: boolean;
  needsApproval: boolean;
}

export function activitySessionKey(agentId: string, sessionId: string) {
  return `${agentId}:${sessionId}`;
}

export function toActivitySessions(
  attention: readonly AttentionItem[],
  runningAgentIds: ReadonlySet<string>,
  waitingSessionKeys: ReadonlySet<string> = new Set(),
): ActivitySession[] {
  return attention
    .map((session) => {
      const id = activitySessionKey(session.agentId, session.sessionId);
      return {
        id,
        session,
        at: session.activityAt ?? session.createdAt,
        working: session.working && runningAgentIds.has(session.agentId),
        unread: isUnreadAttention(session),
        needsApproval: waitingSessionKeys.has(id),
      };
    })
    .sort((a, b) => {
      const byTime = Date.parse(b.at) - Date.parse(a.at);
      return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
    });
}

export interface FilterableSession {
  session: Parameters<typeof channelTypeOfSession>[0];
  working: boolean;
  unread: boolean;
  needsApproval?: boolean;
}

export function matchesActivityFilters(
  item: FilterableSession,
  filters: ActivityFilters,
): boolean {
  if (!filters.channelTypes.has(channelTypeOfSession(item.session)))
    return false;
  switch (filters.state) {
    case "needs-attention":
      return item.needsApproval === true;
    case "in-progress":
      return item.working;
    case "unread":
      return item.unread;
    case "any":
      return true;
  }
}

export function filterActivitySessions<T extends ActivitySession>(
  items: readonly T[],
  filters: ActivityFilters,
): T[] {
  return items.filter((item) => matchesActivityFilters(item, filters));
}
