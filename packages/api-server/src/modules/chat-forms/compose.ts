import type { Db } from "db";
import type {
  ChatFormPreferences,
  ChatFormPreferencesService,
} from "api-server-api/chat-forms";

import { createChatFormPreferencesRepository } from "./infrastructure/preferences-repository.js";
import { createChatFormPreferencesService } from "./services/preferences-service.js";

export function composeChatFormPreferencesForOwner(opts: {
  db: Db;
  ownerSub: string;
  isAgentOwnedBy(agentId: string, ownerSub: string): Promise<boolean>;
}): ChatFormPreferencesService {
  return createChatFormPreferencesService({
    repo: createChatFormPreferencesRepository(opts.db),
    ownerSub: opts.ownerSub,
    isAgentOwnedBy: opts.isAgentOwnedBy,
  });
}

export function createChatFormPreferencesReader(
  db: Db,
): (
  agentId: string,
  flagOn: () => Promise<boolean>,
) => Promise<ChatFormPreferences | null> {
  const repo = createChatFormPreferencesRepository(db);
  return async (agentId, flagOn) => {
    if (!(await flagOn())) return null;
    const preferences = await repo.get(agentId);
    return preferences.forms === "off" ? null : preferences;
  };
}

export function createChatFormPreferencesCleanup(db: Db): {
  listAgentIds(): Promise<string[]>;
  cleanup(agentId: string): Promise<void>;
} {
  const repo = createChatFormPreferencesRepository(db);
  return {
    listAgentIds: () => repo.listAgentIds(),
    cleanup: (agentId) => repo.deleteForAgent(agentId),
  };
}
