import { TRPCError } from "@trpc/server";
import type { ChatFormPreferencesService } from "api-server-api/chat-forms";

import type { ChatFormPreferencesRepository } from "../infrastructure/preferences-repository.js";

export function createChatFormPreferencesService(deps: {
  repo: ChatFormPreferencesRepository;
  ownerSub: string;
  isAgentOwnedBy(agentId: string, ownerSub: string): Promise<boolean>;
}): ChatFormPreferencesService {
  async function requireOwned(agentId: string) {
    if (!(await deps.isAgentOwnedBy(agentId, deps.ownerSub)))
      throw new TRPCError({ code: "NOT_FOUND", message: "agent not found" });
  }

  return {
    async get(agentId) {
      await requireOwned(agentId);
      return deps.repo.get(agentId);
    },
    async set(agentId, preferences) {
      await requireOwned(agentId);
      await deps.repo.set(agentId, preferences);
      return preferences;
    },
  };
}
