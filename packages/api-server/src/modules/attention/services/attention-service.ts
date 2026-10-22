import {
  ATTENTION_FEED_LIMIT,
  type AttentionDismissal,
  type AttentionItem,
  type AttentionList,
  type AttentionService,
  type DefaultModelNotice,
  type OutageAlertNotice,
  type SessionMode,
  type SessionType,
} from "api-server-api";

import type {
  AttentionItemKind,
  AttentionRecordRow,
  DismissalRow,
} from "../domain/types.js";
import type { AttentionRepository } from "../infrastructure/attention-repository.js";

const AGENT_SESSIONS_LIMIT = 50;

function toItem(row: AttentionRecordRow): AttentionItem {
  return {
    agentId: row.agentId,
    sessionId: row.sessionId,
    mode: row.mode as SessionMode,
    type: row.type as SessionType,
    title: row.title,
    scheduleId: row.scheduleId,
    threadTs: row.threadTs,
    harness: row.harness,
    createdAt: row.createdAt.toISOString(),
    activityAt: row.activityAt?.toISOString() ?? null,
    seenAt: row.seenAt?.toISOString() ?? null,
    working: row.working,
  };
}

const agentOfDefaultModelNoticeId = (id: string): string =>
  id.slice(0, Math.max(0, id.lastIndexOf(":")));

function staleDismissals(
  dismissals: readonly DismissalRow[],
  kind: AttentionItemKind,
  current: readonly { id: string }[] | null,
): DismissalRow[] {
  if (current === null) return [];
  const ids = new Set(current.map((notice) => notice.id));
  return dismissals.filter((d) => d.kind === kind && !ids.has(d.itemId));
}

export function createAttentionService(deps: {
  repo: AttentionRepository;
  ownerSub: string;
  ownsApproval: (approvalId: string) => Promise<boolean>;
  ownsAgent: (agentId: string) => Promise<boolean>;
  defaultModelNotices: () => Promise<DefaultModelNotice[]>;
  outageAlerts: () => Promise<OutageAlertNotice[]>;
  log: (message: string) => void;
}): AttentionService {
  return {
    async listForOwner(): Promise<AttentionList> {
      const [records, allDismissals, notices, alerts] = await Promise.all([
        deps.repo.listForOwner(deps.ownerSub, ATTENTION_FEED_LIMIT),
        deps.repo.listDismissals(deps.ownerSub),
        deps.defaultModelNotices().catch((err: Error) => {
          deps.log(`[attention] default-model notices: ${err.message}`);
          return null;
        }),
        deps.outageAlerts().catch((err: Error) => {
          deps.log(`[attention] outage alerts: ${err.message}`);
          return null;
        }),
      ]);
      const resolved = [
        ...staleDismissals(allDismissals, "default-model", notices),
        ...staleDismissals(allDismissals, "outage-alert", alerts),
      ];
      for (const kind of ["default-model", "outage-alert"] as const) {
        const ids = resolved
          .filter((d) => d.kind === kind)
          .map((d) => d.itemId);
        if (ids.length > 0)
          await deps.repo.deleteDismissals(deps.ownerSub, kind, ids);
      }
      const dismissals = allDismissals.filter((d) => !resolved.includes(d));
      return {
        defaultModels: notices ?? [],
        outageAlerts: alerts ?? [],
        items: records.map(toItem),
        dismissed: dismissals.map((d) => ({
          kind: d.kind,
          id: d.itemId,
          at: d.dismissedAt.toISOString(),
        })),
      };
    },

    async sessionsForAgent(agentId) {
      if (!(await deps.ownsAgent(agentId))) return [];
      const records = await deps.repo.listForOwnerAgent(
        deps.ownerSub,
        agentId,
        AGENT_SESSIONS_LIMIT,
      );
      return records.map(toItem);
    },

    async dismiss({ items }) {
      const at = new Date();
      const sessions = items.filter((item) => item.kind === "session");
      const owned =
        sessions.length > 0
          ? await deps.repo.ownedSessionKeys(deps.ownerSub)
          : new Set<string>();

      const approvals = await Promise.all(
        items
          .filter((item) => item.kind === "approval")
          .map(async (item) => ({
            item,
            owned: await deps.ownsApproval(item.id),
          })),
      );

      const defaultModels = await Promise.all(
        items
          .filter((item) => item.kind === "default-model")
          .map(async (item) => ({
            item,
            owned: await deps.ownsAgent(agentOfDefaultModelNoticeId(item.id)),
          })),
      );

      const outageAlerts = items.filter((item) => item.kind === "outage-alert");
      const currentAlerts = new Set(
        outageAlerts.length > 0
          ? (
              await deps.outageAlerts().catch((err: Error) => {
                deps.log(`[attention] outage alerts: ${err.message}`);
                return [];
              })
            ).map((alert) => alert.id)
          : [],
      );

      await deps.repo.setDismissals(
        deps.ownerSub,
        [
          ...sessions.filter((item) => owned.has(item.id)),
          ...approvals.filter((a) => a.owned).map((a) => a.item),
          ...defaultModels.filter((d) => d.owned).map((d) => d.item),
          ...outageAlerts.filter((item) => currentAlerts.has(item.id)),
        ].map((item) => ({ kind: item.kind, itemId: item.id })),
        at,
      );
    },
  };
}
