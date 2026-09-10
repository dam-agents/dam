import type { ApprovalView } from "api-server-api";
import { SessionMode } from "api-server-api";

import type { SessionView } from "../../../types.js";
import type { NotificationItem } from "./notification-types.js";

function isUnread(session: SessionView): boolean {
  if (session.mode === SessionMode.Terminal) return false;
  if (!session.seenAt || !session.updatedAt) return false;
  return Date.parse(session.updatedAt) > Date.parse(session.seenAt);
}

function sessionAt(session: SessionView): string | null {
  return session.updatedAt ?? session.createdAt ?? null;
}

export interface NotificationSources {
  approvals: readonly ApprovalView[];
  byAgent: readonly {
    agentId: string;
    sessions: readonly SessionView[];
  }[];
}

export function buildNotificationItems(
  sources: NotificationSources,
): NotificationItem[] {
  const items: NotificationItem[] = [];

  for (const approval of sources.approvals) {
    const isNetwork = approval.payload.kind === "ext_authz";
    items.push({
      type: isNetwork ? "approval-network" : "approval-tool",
      id: `approval:${approval.id}`,
      agentId: approval.agentId,
      at: approval.createdAt,
      approval,
    });
  }

  for (const { agentId, sessions } of sources.byAgent) {
    for (const session of sessions) {
      if (session.running) {
        items.push({
          type: "running",
          id: `running:${agentId}:${session.sessionId}`,
          agentId,
          at: sessionAt(session),
          session,
        });
        continue;
      }
      if (isUnread(session)) {
        items.push({
          type: "unread",
          id: `unread:${agentId}:${session.sessionId}`,
          agentId,
          at: sessionAt(session),
          session,
        });
      }
    }
  }

  return sortItems(items);
}

export function sortItems(
  items: readonly NotificationItem[],
): NotificationItem[] {
  return [...items].sort((a, b) => {
    if (a.at === null && b.at === null) return a.id.localeCompare(b.id);
    if (a.at === null) return -1;
    if (b.at === null) return 1;
    const byTime = Date.parse(b.at) - Date.parse(a.at);
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
}
