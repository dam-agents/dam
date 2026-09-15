import type {
  AttentionDismissal,
  AttentionItem,
  AttentionList,
  AttentionService,
  SessionMode,
  SessionType,
} from "api-server-api";

import type { AttentionRecordRow } from "../domain/types.js";
import type { AttentionRepository } from "../infrastructure/attention-repository.js";

const FEED_LIMIT = 200;

function toItem(row: AttentionRecordRow): AttentionItem {
  return {
    agentId: row.agentId,
    sessionId: row.sessionId,
    mode: row.mode as SessionMode,
    type: row.type as SessionType,
    title: row.title,
    scheduleId: row.scheduleId,
    experimentId: row.experimentId,
    createdAt: row.createdAt.toISOString(),
    activityAt: row.activityAt?.toISOString() ?? null,
    seenAt: row.seenAt?.toISOString() ?? null,
    working: row.working,
  };
}

export function createAttentionService(deps: {
  repo: AttentionRepository;
  ownerSub: string;
  ownsApproval: (approvalId: string) => Promise<boolean>;
}): AttentionService {
  const ownsItem = async ({
    kind,
    id,
  }: AttentionDismissal): Promise<boolean> => {
    if (kind === "approval") return deps.ownsApproval(id);
    const separator = id.indexOf(":");
    if (separator <= 0) return false;
    const record = await deps.repo.getRecord(
      id.slice(0, separator),
      id.slice(separator + 1),
    );
    return record?.ownerSub === deps.ownerSub;
  };

  return {
    async listForOwner(): Promise<AttentionList> {
      const [records, dismissals] = await Promise.all([
        deps.repo.listForOwner(deps.ownerSub, FEED_LIMIT),
        deps.repo.listDismissals(deps.ownerSub),
      ]);
      return {
        items: records.map(toItem),
        dismissed: dismissals.map((d) => ({
          kind: d.kind,
          id: d.itemId,
          at: d.dismissedAt.toISOString(),
        })),
      };
    },

    async dismiss({ items }) {
      const at = new Date();
      for (const item of items) {
        if (!(await ownsItem(item))) continue;
        await deps.repo.setDismissal(deps.ownerSub, item.kind, item.id, at);
      }
    },
  };
}
