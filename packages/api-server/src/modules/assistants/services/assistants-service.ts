import { TRPCError } from "@trpc/server";
import {
  type AgentsService,
  type AssistantsService,
  assistantInstructions,
} from "api-server-api";

import { getLogger } from "../../../core/logger.js";
import type { InfraAgent } from "../../agents/infrastructure/agent-mappers.js";
import { generateK8sName } from "../../agents/infrastructure/configmap-mappers.js";
import type {
  AssistantRow,
  AssistantsRepository,
} from "../infrastructure/assistants-repository.js";

/** UNIT_BOUNDARY_DESCRIPTION: what the checklist's first task needs of the Agent the platform made: which Agent it is and the avatar the person sees on it. */
export interface CreatedAgent {
  id: string;
  name: string;
  avatar: string | null | undefined;
}

export interface AssistantProvisioning {
  assistants: AssistantsService;
  /* UNIT_BOUNDARY_DESCRIPTION: gives this person their assistant if they have none yet — an ordinary Agent, on their default profile, named by the brand, with the greeting's instructions written once at its create. A person whose Agent is there is answered at once: it is made exactly once, and a deleted one stays deleted. */
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
 * The row is what makes it single: written before the Agent exists and settled by
 * the primary key, so concurrent requests make one Agent between them; `ready`
 * marks the Agent it names as there, so a create in flight is never mistaken for
 * an assistant the person deleted, and a delete leaves the row behind so nothing
 * recreates it on a request.
 */
export function createAssistantsService(deps: {
  repo: AssistantsRepository;
  owner: string;
  assistantName: string;
  brandName: string;
  /* UNIT_BOUNDARY_DESCRIPTION: whether the feature is on for this person, which is what the reset is refused on. */
  enabled: () => Promise<boolean>;
  /* UNIT_BOUNDARY_DESCRIPTION: whether the person has accepted the Terms of Use, which is what makes them admitted: a create for someone who has not is not offered at all. A person whose Agent is already there costs no read of this. */
  admitted: () => Promise<boolean>;
  agentOf: (agentId: string) => Promise<InfraAgent | null>;
  agents: Pick<AgentsService, "list" | "create">;
  /* UNIT_BOUNDARY_DESCRIPTION: decides once whether the checklist applies to this person, before the Agent exists, so the Agent it is about to make is not taken for one they had before. */
  enrolled: () => Promise<void>;
  /* UNIT_BOUNDARY_DESCRIPTION: how the checklist learns of the Agent the platform made — its first task, recorded done and seen, so nothing celebrates an Agent nobody made. */
  provisioned: (agent: CreatedAgent) => Promise<void>;
  /* UNIT_BOUNDARY_DESCRIPTION: the checklist's own reset, the one its button under Experimental features calls, so both doors start it over the same way. */
  resetChecklist: () => Promise<unknown>;
}): AssistantProvisioning {
  const created = (agent: InfraAgent): CreatedAgent => ({
    id: agent.id,
    name: agent.name,
    avatar: agent.spec.avatar,
  });

  /* UNIT_BOUNDARY_DESCRIPTION: the one create both doors use — the first request and a reset that finds the Agent gone — so the name, the instructions and the checklist's first task land the same way whichever asked. */
  const create = async (agentId: string): Promise<void> => {
    await deps.enrolled();
    const name = freeName(
      deps.assistantName,
      new Set((await deps.agents.list()).map((agent) => agent.name)),
    );
    await deps.agents.create({
      id: agentId,
      name,
      instructions: assistantInstructions({
        assistantName: deps.assistantName,
        brandName: deps.brandName,
      }),
    });
  };

  /* UNIT_BOUNDARY_DESCRIPTION: makes the Agent the row already names, once, and records the checklist's first task when it becomes ready. Nothing here invents an id: a create in flight, a crashed claim and a reset all ask for the same Agent, so the store's own create settles which of them makes it and the others adopt it. */
  const makeAgent = async (row: AssistantRow): Promise<InfraAgent | null> => {
    let agent = await deps.agentOf(row.agentId);
    if (agent === null) {
      try {
        await create(row.agentId);
      } catch (err) {
        // UNIT_BOUNDARY_DESCRIPTION: a replica that raced this one may have made the very same Agent, which is adoption rather than failure — a create that failed for any other reason must not be reported as done.
        if ((await deps.agentOf(row.agentId)) === null) throw err;
      }
      agent = await deps.agentOf(row.agentId);
    } else if (row.state === "ready") {
      return agent;
    }
    if (agent === null) return null;
    await deps.repo.markReady(deps.owner, row.agentId);
    await deps.provisioned(created(agent));
    return agent;
  };

  return {
    assistants: {
      async state() {
        const row = await deps.repo.find(deps.owner);
        return row === null
          ? null
          : {
              agentId: row.agentId,
              used: row.used,
              resetAt: row.resetAt?.toISOString() ?? null,
            };
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
        let current = row;
        /* UNIT_BOUNDARY_DESCRIPTION: only an Agent that was there and is gone was deleted, and only that one is replaced. A create in flight is adopted as it is, so a reset that meets the first request makes no second Agent. */
        if (
          current.state === "ready" &&
          (await deps.agentOf(current.agentId)) === null
        ) {
          const replacement = generateK8sName("agent");
          if (
            await deps.repo.replaceAgent(
              deps.owner,
              current.agentId,
              replacement,
            )
          ) {
            current = { ...current, agentId: replacement, state: "creating" };
          } else {
            const moved = await deps.repo.find(deps.owner);
            if (moved === null) return;
            current = moved;
          }
        }
        const agent =
          current.state === "ready"
            ? await deps.agentOf(current.agentId)
            : await makeAgent(current);
        await deps.repo.resetUsed(deps.owner);
        if (current.state === "ready" && agent !== null)
          await deps.provisioned(created(agent));
      },
    },

    async ensure() {
      try {
        const row = await deps.repo.find(deps.owner);
        if (row?.state === "ready") return;
        if (!(await deps.enabled())) return;
        if (!(await deps.admitted())) return;
        if (row !== null) {
          await makeAgent(row);
          return;
        }
        const agentId = generateK8sName("agent");
        if (!(await deps.repo.claim(deps.owner, agentId))) return;
        await makeAgent({
          owner: deps.owner,
          agentId,
          state: "creating",
          used: false,
          resetAt: null,
        });
      } catch (err) {
        getLogger().warn(
          { err, owner: deps.owner },
          "assistant.provision_failed",
        );
      }
    },
  };
}
