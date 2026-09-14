import type {
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
}): AttentionService {
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
  };
}
