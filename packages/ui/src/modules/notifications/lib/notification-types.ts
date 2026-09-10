import type { ApprovalView } from "api-server-api";

import type { SessionView } from "../../../types.js";

export const NOTIFICATION_TYPES = [
  "approval-tool",
  "approval-network",
  "running",
  "unread",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  "approval-tool": "Tool requests",
  "approval-network": "Network requests",
  running: "Running",
  unread: "Unread",
};

export type NotificationItem =
  | {
      type: "approval-tool";
      id: string;
      agentId: string;
      at: string | null;
      approval: ApprovalView;
    }
  | {
      type: "approval-network";
      id: string;
      agentId: string;
      at: string | null;
      approval: ApprovalView;
    }
  | {
      type: "running";
      id: string;
      agentId: string;
      at: string | null;
      session: SessionView;
    }
  | {
      type: "unread";
      id: string;
      agentId: string;
      at: string | null;
      session: SessionView;
    };

export function notificationType(item: NotificationItem): NotificationType {
  return item.type;
}

export function isNeedsYou(item: NotificationItem): boolean {
  return item.type === "approval-tool" || item.type === "approval-network";
}
