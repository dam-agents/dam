import type { AssistantNotice, AssistantsService } from "api-server-api";
import type { AssistantsRepository } from "../infrastructure/assistants-repository.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the owner is told about their assistant: the
 * one-time news that provisioning renamed an Agent they already had to free the
 * reserved name, until they dismiss it. Nothing else about the assistant is the
 * owner's to read here; its Agent speaks for itself in the agent list.
 */
export function createAssistantsService(deps: {
  repo: AssistantsRepository;
  owner: string;
}): AssistantsService {
  return {
    async notice(): Promise<AssistantNotice | null> {
      const row = await deps.repo.find(deps.owner);
      if (!row?.renamed || row.noticeSeen) return null;
      return { renamedFrom: row.renamed.from, renamedTo: row.renamed.to };
    },
    async dismissNotice() {
      await deps.repo.markNoticeSeen(deps.owner);
    },
  };
}
