import type {
  AttentionService,
  DefaultModelNotice,
  OutageAlertNotice,
} from "api-server-api";
import type { RuntimeFeatures } from "agent-runtime-api";
import type { Db } from "db";

import type { InfraAgent } from "../agents/infrastructure/agent-mappers.js";

import { ATTENTION_RETENTION_DAYS } from "./domain/types.js";
import { createAttentionRepository } from "./infrastructure/attention-repository.js";
import { createSessionWatchClient } from "./infrastructure/session-watch-client.js";
import { createAttentionService } from "./services/attention-service.js";
import {
  createSessionWatcher,
  type SessionWatcher,
} from "./services/session-watcher.js";

export function composeAttentionService(deps: {
  db: Db;
  ownerSub: string;
  ownsApproval: (approvalId: string) => Promise<boolean>;
  ownsAgent: (agentId: string) => Promise<boolean>;
  defaultModelNotices: () => Promise<DefaultModelNotice[]>;
  outageAlerts: () => Promise<OutageAlertNotice[]>;
}): AttentionService {
  return createAttentionService({
    repo: createAttentionRepository(deps.db),
    ownerSub: deps.ownerSub,
    ownsApproval: deps.ownsApproval,
    ownsAgent: deps.ownsAgent,
    defaultModelNotices: deps.defaultModelNotices,
    outageAlerts: deps.outageAlerts,
    log: (message) => process.stderr.write(`${message}\n`),
  });
}

export function composeAttentionRetention(db: Db): {
  retentionTick: () => Promise<void>;
} {
  const repo = createAttentionRepository(db);
  return {
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
  onTurnEnded?: (agentId: string, sessionId: string) => void;
  log: (message: string) => void;
}): SessionWatcher {
  return createSessionWatcher({
    listAgents: deps.listAgents,
    ...(deps.onTurnEnded ? { onTurnEnded: deps.onTurnEnded } : {}),
    runtimeFeaturesFor: deps.runtimeFeaturesFor,
    sessions: createSessionWatchClient(deps.namespace, deps.log),
    repo: createAttentionRepository(deps.db),
    log: deps.log,
  });
}
