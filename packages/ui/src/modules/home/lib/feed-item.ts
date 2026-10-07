import type { ApprovalView, AttentionItem } from "api-server-api";

import { isFeedableAttention } from "./unread.js";

export type FeedItem =
  | {
      kind: "approval";
      id: string;
      agentId: string;
      at: string | null;
      approval: ApprovalView;
    }
  | {
      kind: "in-progress";
      id: string;
      agentId: string;
      at: string | null;
      session: AttentionItem;
    }
  | {
      kind: "unread";
      id: string;
      agentId: string;
      at: string | null;
      session: AttentionItem;
    };

interface FeedSources {
  approvals: readonly ApprovalView[];
  attention: readonly AttentionItem[];
  runningAgentIds: ReadonlySet<string>;
}

function sessionAt(session: AttentionItem): string | null {
  return session.activityAt ?? session.createdAt;
}

export function toFeedItems(
  { approvals, attention, runningAgentIds }: FeedSources,
  now: number = Date.now(),
): FeedItem[] {
  const items: FeedItem[] = approvals.map((approval) => ({
    kind: "approval",
    id: `approval:${approval.id}`,
    agentId: approval.agentId,
    at: approval.createdAt,
    approval,
  }));

  for (const session of attention) {
    const agentId = session.agentId;
    if (session.working && runningAgentIds.has(agentId)) {
      items.push({
        kind: "in-progress",
        id: `running:${agentId}:${session.sessionId}`,
        agentId,
        at: sessionAt(session),
        session,
      });
      continue;
    }
    if (isFeedableAttention(session, now)) {
      items.push({
        kind: "unread",
        id: `unread:${agentId}:${session.sessionId}`,
        agentId,
        at: sessionAt(session),
        session,
      });
    }
  }

  return sortFeedItems(items);
}

export function sortFeedItems(items: readonly FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => {
    if (a.at === null && b.at === null) return a.id.localeCompare(b.id);
    if (a.at === null) return -1;
    if (b.at === null) return 1;
    const byTime = Date.parse(b.at) - Date.parse(a.at);
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
}
