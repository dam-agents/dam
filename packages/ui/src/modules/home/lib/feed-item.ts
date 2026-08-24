import type { ApprovalView } from "api-server-api";

import type { SessionView } from "../../../types.js";
import { isUnreadSession } from "./unread.js";

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
      session: SessionView;
    }
  | {
      kind: "unread";
      id: string;
      agentId: string;
      at: string | null;
      session: SessionView;
    };

export interface FeedSources {
  approvals: readonly ApprovalView[];
  byAgent: readonly {
    agentId: string;
    sessions: readonly SessionView[];
  }[];
}

function sessionAt(session: SessionView): string | null {
  return session.updatedAt ?? session.createdAt ?? null;
}

export function toFeedItems({ approvals, byAgent }: FeedSources): FeedItem[] {
  const items: FeedItem[] = approvals.map((approval) => ({
    kind: "approval",
    id: `approval:${approval.id}`,
    agentId: approval.agentId,
    at: approval.createdAt,
    approval,
  }));

  for (const { agentId, sessions } of byAgent) {
    for (const session of sessions) {
      if (session.running) {
        items.push({
          kind: "in-progress",
          id: `running:${agentId}:${session.sessionId}`,
          agentId,
          at: sessionAt(session),
          session,
        });
        continue;
      }
      if (isUnreadSession(session)) {
        items.push({
          kind: "unread",
          id: `unread:${agentId}:${session.sessionId}`,
          agentId,
          at: sessionAt(session),
          session,
        });
      }
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
