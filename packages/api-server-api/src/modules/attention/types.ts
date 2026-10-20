import type { SessionMode, SessionType } from "../sessions/types.js";

export const ATTENTION_FEED_LIMIT = 200;

export type AttentionItemKind = "session" | "approval" | "default-model";

/**
 * UNIT_BOUNDARY_DESCRIPTION: why an Agent's saved default needs its owner:
 * none is set, the Agent holds no model provider to pick one from, its
 * model's provider is no longer the Agent's, or the conversion of an old
 * default runs it on another model than the one its setting named.
 */
export type DefaultModelState =
  "not-set" | "no-provider" | "provider-gone" | "changed";

export interface DefaultModelNotice {
  id: string;
  agentId: string;
  state: DefaultModelState;
  harness: string;
  model: string | null;
  changedFrom: string | null;
}

export interface AttentionItem {
  agentId: string;
  sessionId: string;
  mode: SessionMode;
  type: SessionType;
  title: string | null;
  scheduleId: string | null;
  threadTs: string | null;
  harness: string | null;
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
  defaultModels: DefaultModelNotice[];
}

export interface AttentionDismissal {
  kind: AttentionItemKind;
  id: string;
}

export interface AttentionService {
  listForOwner(): Promise<AttentionList>;
  sessionsForAgent(agentId: string): Promise<AttentionItem[]>;
  dismiss(input: { items: readonly AttentionDismissal[] }): Promise<void>;
}
