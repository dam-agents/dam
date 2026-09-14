import type { AttentionService } from "api-server-api";
import type { Db } from "db";

import { ATTENTION_RETENTION_DAYS } from "./domain/types.js";
import {
  createAttentionRepository,
  type AttentionRepository,
} from "./infrastructure/attention-repository.js";
import { createAttentionService } from "./services/attention-service.js";

export function composeAttentionService(deps: {
  db: Db;
  ownerSub: string;
}): AttentionService {
  return createAttentionService({
    repo: createAttentionRepository(deps.db),
    ownerSub: deps.ownerSub,
  });
}

export function composeAttentionRetention(db: Db): {
  repo: AttentionRepository;
  retentionTick: () => Promise<void>;
} {
  const repo = createAttentionRepository(db);
  return {
    repo,
    retentionTick: async () => {
      const n = await repo.deleteOlderThan(ATTENTION_RETENTION_DAYS);
      if (n > 0) {
        process.stderr.write(
          `[attention/retention] deleted ${n} attention_records older than ${ATTENTION_RETENTION_DAYS}d\n`,
        );
      }
    },
  };
}

export function createAttentionCleanupHook(
  db: Db,
): (agentId: string) => Promise<void> {
  const repo = createAttentionRepository(db);
  return (agentId: string) => repo.deleteForAgent(agentId);
}

export function listAttentionAgentIds(db: Db): Promise<string[]> {
  return createAttentionRepository(db).listAgentIds();
}
