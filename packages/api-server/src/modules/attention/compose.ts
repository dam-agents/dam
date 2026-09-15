import type { AttentionService } from "api-server-api";
import type { RuntimeFeatures } from "agent-runtime-api";
import type { Db } from "db";

import type { InfraAgent } from "../agents/infrastructure/agent-mappers.js";

import { ATTENTION_RETENTION_DAYS } from "./domain/types.js";
import {
  createAttentionRepository,
  type AttentionRepository,
} from "./infrastructure/attention-repository.js";
import { createPodSessionClient } from "./infrastructure/pod-session-watch.js";
import { createAttentionService } from "./services/attention-service.js";
import {
  createSessionWatcher,
  type SessionWatcher,
} from "./services/session-watcher.js";

export function composeAttentionService(deps: {
  db: Db;
  ownerSub: string;
  ownsApproval: (approvalId: string) => Promise<boolean>;
}): AttentionService {
  return createAttentionService({
    repo: createAttentionRepository(deps.db),
    ownerSub: deps.ownerSub,
    ownsApproval: deps.ownsApproval,
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

export function composeSessionWatcher(deps: {
  db: Db;
  namespace: string;
  listAgents: () => Promise<InfraAgent[]>;
  runtimeFeaturesFor: (
    agentIds: string[],
  ) => Promise<Map<string, RuntimeFeatures>>;
  log: (message: string) => void;
}): SessionWatcher {
  return createSessionWatcher({
    listAgents: deps.listAgents,
    runtimeFeaturesFor: deps.runtimeFeaturesFor,
    pods: createPodSessionClient(deps.namespace, deps.log),
    repo: createAttentionRepository(deps.db),
    log: deps.log,
  });
}
