import type { Db } from "db";
import type {
  AttentionItem,
  SessionPinKey,
  SessionPinsService,
} from "api-server-api";

import { createSessionPinsRepository } from "./infrastructure/session-pins-repository.js";
import { createSessionPinsService } from "./services/session-pins-service.js";

export interface SessionPinsModule {
  forOwner(
    owner: string,
    mayPin: (agentId: string) => Promise<boolean>,
  ): SessionPinsService;
  pinnedSessionKeys(): Promise<Set<string>>;
  listAgentIds(): Promise<string[]>;
  deleteForAgent(agentId: string): Promise<void>;
  deleteSessions(agentId: string, sessionIds: readonly string[]): Promise<void>;
}

export function composeSessionPinsModule(deps: {
  db: Db;
  attentionItemsOf: (
    owner: string,
    keys: readonly SessionPinKey[],
  ) => Promise<AttentionItem[]>;
}): SessionPinsModule {
  const repo = createSessionPinsRepository(deps.db);
  return {
    forOwner: (owner, mayPin) =>
      createSessionPinsService({
        repo,
        owner,
        mayPin,
        attentionItemsOf: deps.attentionItemsOf,
      }),
    pinnedSessionKeys: () => repo.listPinnedSessionKeys(),
    listAgentIds: () => repo.listAgentIds(),
    deleteForAgent: (agentId) => repo.deleteForAgent(agentId),
    deleteSessions: (agentId, sessionIds) =>
      repo.deleteSessions(agentId, sessionIds),
  };
}
