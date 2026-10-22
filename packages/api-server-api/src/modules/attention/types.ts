import type { DefaultKind } from "../harness-config/types.js";
import type { SessionMode, SessionType } from "../sessions/types.js";

export const ATTENTION_FEED_LIMIT = 200;

export type AttentionItemKind =
  "session" | "approval" | "default-model" | "outage-alert";

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
  kinds: DefaultKind[];
  state: DefaultModelState;
  harness: string;
  model: string | null;
  changedFrom: string | null;
}

export type OutageAlertAffectedBy =
  "failed-calls" | "schedule" | "slack" | "telegram";

export interface OutageAlertAgent {
  agentId: string;
  name: string;
  affectedBy: OutageAlertAffectedBy[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: an outage alert of the caller: a provider outage
 * that hits their agents, told until the provider works again, then shown as
 * recovered for a while. The id holds the template, the start time and the
 * state, so a dismissal hides only this outage in this state.
 */
export interface OutageAlertNotice {
  id: string;
  templateId: string;
  since: string;
  recoveredAt: string | null;
  statusPageUrl: string | null;
  agents: OutageAlertAgent[];
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
  outageAlerts: OutageAlertNotice[];
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
