import type { AssistantsService } from "api-server-api";
import type { AssistantsRepository } from "../infrastructure/assistants-repository.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the owner is told about their assistant: which
 * Agent it is, whether it has ever had a session — the UI lands a person in its
 * chat until it has — and the one-time news that provisioning renamed an Agent
 * they already had, until they dismiss it. Nothing else about the assistant is
 * the owner's to read here; its Agent speaks for itself in the agent list.
 */
export function createAssistantsService(deps: {
  repo: AssistantsRepository;
  owner: string;
}): AssistantsService {
  return {
    async state() {
      const row = await deps.repo.find(deps.owner);
      if (row === null) return null;
      return {
        agentId: row.agentId,
        used: row.used,
        notice:
          row.renamed === null || row.noticeSeen
            ? null
            : { renamedFrom: row.renamed.from, renamedTo: row.renamed.to },
      };
    },
    async dismissNotice() {
      await deps.repo.markNoticeSeen(deps.owner);
    },
  };
}
