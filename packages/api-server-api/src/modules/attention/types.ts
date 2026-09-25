import type { SessionMode, SessionType } from "../sessions/types.js";

export type AttentionItemKind = "session" | "approval";

export interface AttentionItem {
  agentId: string;
  sessionId: string;
  mode: SessionMode;
  type: SessionType;
  title: string | null;
  scheduleId: string | null;
  createdAt: string;
  activityAt: string | null;
  seenAt: string | null;
  working: boolean;
}

export interface DismissedEntry {
  kind: AttentionItemKind;
  id: string;
  at: string;
}

export interface AttentionList {
  items: AttentionItem[];
  dismissed: DismissedEntry[];
}

export interface AttentionDismissal {
  kind: AttentionItemKind;
  id: string;
}

export interface AttentionService {
  listForOwner(): Promise<AttentionList>;
  dismiss(input: { items: readonly AttentionDismissal[] }): Promise<void>;
}
