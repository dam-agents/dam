import { TRPCError } from "@trpc/server";
import {
  type AgentsService,
  type AssistantsService,
  assistantInstructions,
} from "api-server-api";

import { getLogger } from "../../../core/logger.js";
import type { InfraAgent } from "../../agents/infrastructure/agent-mappers.js";
import { generateK8sName } from "../../agents/infrastructure/configmap-mappers.js";
import type { AssistantsRepository } from "../infrastructure/assistants-repository.js";

/** UNIT_BOUNDARY_DESCRIPTION: what the checklist's first task needs of the Agent the platform made: which Agent it is and the avatar the person sees on it. */
export interface CreatedAgent {
  id: string;
  name: string;
  avatar: string | null | undefined;
}

export interface AssistantProvisioning {
  assistants: AssistantsService;
  /* UNIT_BOUNDARY_DESCRIPTION: gives this person their assistant if they have none yet — an ordinary Agent, on their default profile, named by the brand, with the greeting's instructions written once at its create. A person whose row exists is answered at once: the Agent is made exactly once, and a deleted one stays deleted. */
  ensure: () => Promise<void>;
}

/** UNIT_BOUNDARY_DESCRIPTION: the name the assistant takes when the owner already has an Agent by that name: the next free number after it. */
export function freeName(
  assistantName: string,
  taken: ReadonlySet<string>,
): string {
  if (!taken.has(assistantName)) return assistantName;
  for (let n = 2; ; n += 1) {
    const candidate = `${assistantName} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one Agent the platform gives a person, and the
 * only two things anyone may ask of it here. It is an ordinary Agent, created
 * through the ordinary create, so everything the catalogue offers it offers the
 * assistant: renaming, deleting, disabling, editors, channels, a different model.
 * The row is what makes it single: written before the Agent exists, settled by
 * the primary key, so concurrent requests make one Agent between them, and a
 * delete leaves the row behind so nothing recreates it on a request.
 */
export function createAssistantsService(deps: {
  repo: AssistantsRepository;
  owner: string;
  assistantName: string;
  brandName: string;
  /* UNIT_BOUNDARY_DESCRIPTION: whether the feature is on for this person, which is what the reset is refused on; the caller asks the same question before it provisions. */
  enabled: () => Promise<boolean>;
  agentOf: (agentId: string) => Promise<InfraAgent | null>;
  agents: Pick<AgentsService, "list" | "create">;
  /* UNIT_BOUNDARY_DESCRIPTION: decides once whether the checklist applies to this person, before the Agent exists, so the Agent it is about to make is not taken for one they had before. */
  enrolled: () => Promise<void>;
  /* UNIT_BOUNDARY_DESCRIPTION: how the checklist learns of the Agent the platform made — its first task, recorded done and seen, so nothing celebrates an Agent nobody made. */
  provisioned: (agent: CreatedAgent) => Promise<void>;
  /* UNIT_BOUNDARY_DESCRIPTION: the checklist's own reset, the one its button under Experimental features calls, so both doors start it over the same way. */
  resetChecklist: () => Promise<unknown>;
}): AssistantProvisioning {
  /* UNIT_BOUNDARY_DESCRIPTION: one create for both doors — the first request and a reset that finds the Agent gone — so the name, the instructions and the checklist's first task land the same way whichever asked. */
  const create = async (agentId: string): Promise<void> => {
    await deps.enrolled();
    const name = freeName(
      deps.assistantName,
      new Set((await deps.agents.list()).map((agent) => agent.name)),
    );
    const agent = await deps.agents.create({
      id: agentId,
      name,
      instructions: assistantInstructions({
        assistantName: deps.assistantName,
        brandName: deps.brandName,
      }),
    });
    await deps.provisioned({
      id: agent.id,
      name: agent.name,
      avatar: agent.spec.avatar,
    });
  };

  return {
    assistants: {
      async state() {
        const row = await deps.repo.find(deps.owner);
        return row === null ? null : { agentId: row.agentId, used: row.used };
      },

      async resetOnboarding() {
        if (!(await deps.enabled()))
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "This install does not offer the assistant to you.",
          });
        const row = await deps.repo.find(deps.owner);
        await deps.resetChecklist();
        if (row === null) return;
        const current = await deps.agentOf(row.agentId);
        if (current !== null) {
          await deps.repo.resetUsed(deps.owner);
          await deps.provisioned({
            id: current.id,
            name: current.name,
            avatar: current.spec.avatar,
          });
          return;
        }
        // UNIT_BOUNDARY_DESCRIPTION: the person deleted their assistant, so the reset makes one again — through the same compare-and-set claim as the first create, since two resets at once make one Agent between them.
        const replacement = generateK8sName("agent");
        if (
          !(await deps.repo.replaceAgent(deps.owner, row.agentId, replacement))
        )
          return;
        await create(replacement);
      },
    },

    async ensure() {
      try {
        if ((await deps.repo.find(deps.owner)) !== null) return;
        if (!(await deps.enabled())) return;
        const agentId = generateK8sName("agent");
        if (!(await deps.repo.claim(deps.owner, agentId))) return;
        try {
          await create(agentId);
        } catch (err) {
          // UNIT_BOUNDARY_DESCRIPTION: a create that failed before the Agent existed gives its claim back, so a later request tries again; one that failed afterwards — the greeting's instructions or the checklist's own record — keeps it, since the Agent is there.
          if ((await deps.agentOf(agentId)) === null)
            await deps.repo.release(deps.owner, agentId);
          throw err;
        }
      } catch (err) {
        getLogger().warn(
          { err, owner: deps.owner },
          "assistant.provision_failed",
        );
      }
    },
  };
}
