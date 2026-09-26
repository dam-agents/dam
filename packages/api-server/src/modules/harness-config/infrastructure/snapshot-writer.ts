import type { Db } from "db";
import {
  createHarnessConfigSnapshotRepo,
  type HarnessConfigSnapshotRepo,
} from "./snapshot-repo.js";
import { emit, EventType } from "../../../events.js";

export function createHarnessConfigSnapshotWriter(deps: {
  db: Db;
  resolveOwner: (agentId: string) => Promise<string | null>;
}): Pick<HarnessConfigSnapshotRepo, "merge"> {
  const repo = createHarnessConfigSnapshotRepo(deps.db);
  return {
    async merge(agentId, patch, opts) {
      await repo.merge(agentId, patch, opts);
      if (!opts.confirmed) return;
      const ownerSub = await deps.resolveOwner(agentId);
      if (!ownerSub) return;
      emit({ type: EventType.HarnessConfigChanged, agentId, ownerSub });
    },
  };
}
