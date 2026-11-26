import type {
  AttentionItem,
  AttentionService,
  CostReviewOffer,
  DefaultModelNotice,
  OutageAlertNotice,
  OwnerQuestionNotice,
  SecurityCheckReport,
} from "api-server-api";
import type { RuntimeFeatures } from "agent-runtime-api";
import type { Db } from "db";

import type { InfraAgent } from "../agents/infrastructure/agent-mappers.js";

import { ATTENTION_RETENTION_DAYS } from "./domain/types.js";
import { createAttentionRepository } from "./infrastructure/attention-repository.js";
import { createSessionWatchClient } from "./infrastructure/session-watch-client.js";
import {
  createAttentionService,
  toItem,
} from "./services/attention-service.js";
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
  costReviews: () => Promise<CostReviewOffer[]>;
  ownerQuestions: () => Promise<OwnerQuestionNotice[]>;
  securityCheck: () => Promise<SecurityCheckReport | null>;
}): AttentionService {
  return createAttentionService({
    repo: createAttentionRepository(deps.db),
    ownerSub: deps.ownerSub,
    ownsApproval: deps.ownsApproval,
    ownsAgent: deps.ownsAgent,
    defaultModelNotices: deps.defaultModelNotices,
    outageAlerts: deps.outageAlerts,
    costReviews: deps.costReviews,
    ownerQuestions: deps.ownerQuestions,
    securityCheck: deps.securityCheck,
    log: (message) => process.stderr.write(`${message}\n`),
  });
}

export function composeAttentionRetention(deps: {
  db: Db;
  keptSessions: () => Promise<ReadonlySet<string>>;
}): {
  retentionTick: () => Promise<void>;
} {
  const repo = createAttentionRepository(deps.db);
  return {
    retentionTick: async () => {
      const n = await repo.deleteOlderThan(
        ATTENTION_RETENTION_DAYS,
        await deps.keptSessions(),
      );
      if (n > 0) {
        process.stderr.write(
          `[attention/retention] deleted ${n} attention_records older than ${ATTENTION_RETENTION_DAYS}d\n`,
        );
      }
    },
  };
}

export type AttentionItemsOf = (
  ownerSub: string,
  keys: readonly { agentId: string; sessionId: string }[],
) => Promise<AttentionItem[]>;

export function composeAttentionItemsOf(db: Db): AttentionItemsOf {
  const repo = createAttentionRepository(db);
  return async (ownerSub, keys) =>
    (await repo.listForOwnerSessions(ownerSub, keys)).map(toItem);
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
  onTurnEnded: (agentId: string, sessionId: string) => void;
  onSessionsGone: (agentId: string, sessionIds: readonly string[]) => void;
  log: (message: string) => void;
}): SessionWatcher {
  return createSessionWatcher({
    listAgents: deps.listAgents,
    onTurnEnded: deps.onTurnEnded,
    onSessionsGone: deps.onSessionsGone,
    runtimeFeaturesFor: deps.runtimeFeaturesFor,
    sessions: createSessionWatchClient(deps.namespace, deps.log),
    repo: createAttentionRepository(deps.db),
    log: deps.log,
  });
}
