import { TRPCError } from "@trpc/server";
import type { AssistantsService } from "api-server-api";
import { avatarCharacter } from "api-server-api/avatar/svg";
import type { AvatarCharacter } from "api-server-api/avatar/svg";

import type { InfraAgent } from "../../agents/infrastructure/agent-mappers.js";
import type { AssistantsRepository } from "../infrastructure/assistants-repository.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the owner is told about their assistant: which
 * Agent it is, whether it has ever had a session — the UI lands a person in its
 * chat until it has — and the one-time news that provisioning renamed an Agent
 * they already had, published only once that rename landed, until they dismiss
 * it. Nothing else about the assistant is
 * the owner's to read here; its Agent speaks for itself in the agent list.
 */
export function createAssistantsService(deps: {
  repo: AssistantsRepository;
  owner: string;
  /* UNIT_BOUNDARY_DESCRIPTION: whether the feature is on for this person, which is what the reset is refused on; the same answer provisioning asks for. */
  enabled: () => Promise<boolean>;
  /* UNIT_BOUNDARY_DESCRIPTION: the checklist's own reset, the one its button in Experimental features calls, so both doors start it over the same way. */
  resetChecklist: () => Promise<unknown>;
  /* UNIT_BOUNDARY_DESCRIPTION: how provisioning records the assistant's first task — seen, with no celebration — which the reset records again so the checklist it starts over reads as a first-timer's. */
  recordFirstAgent: (agent: {
    agentId: string;
    character: AvatarCharacter;
  }) => Promise<unknown>;
  agentOf: (agentId: string) => Promise<InfraAgent | null>;
}): AssistantsService {
  return {
    async state() {
      const row = await deps.repo.find(deps.owner);
      if (row === null) return null;
      return {
        agentId: row.agentId,
        used: row.used,
        notice:
          row.renamed === null || !row.renamed.done || row.noticeSeen
            ? null
            : { renamedFrom: row.renamed.from, renamedTo: row.renamed.to },
      };
    },
    async dismissNotice() {
      await deps.repo.markNoticeSeen(deps.owner);
    },
    async resetOnboarding() {
      if (!(await deps.enabled()))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This install does not offer the assistant to you.",
        });
      const row = await deps.repo.find(deps.owner);
      await deps.repo.resetUsed(deps.owner);
      await deps.resetChecklist();
      // UNIT_BOUNDARY_DESCRIPTION: the reset empties the checklist, so the assistant's own first task is recorded again exactly as provisioning records it: seen, and counting 1 of 8, so a reset person's checklist is the one a first-timer meets.
      if (row === null) return;
      const agent = await deps.agentOf(row.agentId);
      if (agent === null) return;
      await deps.recordFirstAgent({
        agentId: agent.id,
        character: avatarCharacter(agent.spec.avatar, deps.owner, agent.name),
      });
    },
  };
}
