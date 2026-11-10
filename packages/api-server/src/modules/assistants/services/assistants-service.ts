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

/** UNIT_BOUNDARY_DESCRIPTION: what the checklist's first task needs of the Agent the platform settled on: which Agent it is and the avatar the person sees on it. */
export interface CreatedAgent {
  id: string;
  name: string;
  avatar: string | null | undefined;
}

export interface AssistantProvisioning {
  assistants: AssistantsService;
  /* UNIT_BOUNDARY_DESCRIPTION: gives this person Dambledore at their first admitted request, for an install that pins the feature on and has no switch to offer them. It happens once per person, through the record: a Dambledore they delete stays deleted until they ask for one. */
  ensure: () => Promise<void>;
  /* UNIT_BOUNDARY_DESCRIPTION: gives this person Dambledore when they turn the feature on. A person who already owns an Agent under the assistant's name gets nothing made — that Agent is what the name means — so deleting or renaming theirs and switching the feature off and on again makes a new one. */
  optIn: () => Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Agent the platform gives a person under its
 * brand's assistant name, and the only two things anyone may ask of it here. It
 * is an ordinary Agent, created through the ordinary create, so everything the
 * catalogue offers it offers the assistant: renaming, deleting, disabling,
 * editors, channels, a different model.
 * The rule for making one is the name: an Agent of the person's already called
 * that is adopted as theirs, and only a person with none gets one made. The
 * record is what makes a pinned-on install's create happen once, and it always
 * names the Agent the name currently resolves to.
 */
export function createAssistantsService(deps: {
  repo: AssistantsRepository;
  owner: string;
  assistantName: string;
  brandName: string;
  /* UNIT_BOUNDARY_DESCRIPTION: whether the feature is on for this person, which is what the reset is refused on. */
  enabled: () => Promise<boolean>;
  /* UNIT_BOUNDARY_DESCRIPTION: whether the person has accepted the Terms of Use, which is what makes them admitted: nothing is made for someone who has not. A person whose Agent is already there costs no read of this. */
  admitted: () => Promise<boolean>;
  agentOf: (agentId: string) => Promise<InfraAgent | null>;
  agents: Pick<AgentsService, "list" | "create">;
  /* UNIT_BOUNDARY_DESCRIPTION: decides once whether the checklist applies to this person, before the Agent exists, so the Agent it is about to make is not taken for one they had before. */
  enrolled: () => Promise<void>;
  /* UNIT_BOUNDARY_DESCRIPTION: how the checklist learns of the Agent the platform made — its first task, recorded done and seen, so nothing celebrates an Agent nobody made. It is also what a reset records again. */
  provisioned: (agent: CreatedAgent) => Promise<void>;
  /* UNIT_BOUNDARY_DESCRIPTION: the checklist's own reset, the one its button under Experimental features calls, so both doors start it over the same way. */
  resetChecklist: () => Promise<unknown>;
}): AssistantProvisioning {
  const created = (agent: InfraAgent): CreatedAgent => ({
    id: agent.id,
    name: agent.name,
    avatar: agent.spec.avatar,
  });

  /* UNIT_BOUNDARY_DESCRIPTION: the one create every door uses — the switch, the pinned-on request and the reset — so the name, the instructions and the checklist's first task land the same way whichever asked. */
  const create = async (agentId: string): Promise<void> => {
    await deps.enrolled();
    await deps.agents.create({
      id: agentId,
      name: deps.assistantName,
      instructions: assistantInstructions({
        assistantName: deps.assistantName,
        brandName: deps.brandName,
      }),
    });
  };

  /* UNIT_BOUNDARY_DESCRIPTION: the Agent the person owns under the assistant's name, matched exactly and case-sensitively — the one the name means, whether the platform made it or they did. */
  const namedAgent = async (): Promise<InfraAgent | null> => {
    const named = (await deps.agents.list()).find(
      (agent) => agent.name === deps.assistantName,
    );
    return named === undefined ? null : deps.agentOf(named.id);
  };

  /* UNIT_BOUNDARY_DESCRIPTION: makes the Agent the record already names, once. Nothing here invents an id: a create in flight and a retry ask for the same Agent, so the store's own create settles which of them makes it and the other adopts it. A create the store refused because the name is taken is adoption too — a sibling got there first. */
  const makeAgent = async (row: AssistantRow): Promise<InfraAgent | null> => {
    let agent = await deps.agentOf(row.agentId);
    if (agent === null) {
      try {
        await create(row.agentId);
      } catch (err) {
        const adopted = await namedAgent();
        if (adopted === null) throw err;
        await deps.repo.pointAt(deps.owner, adopted.id);
        return adopted;
      }
      agent = await deps.agentOf(row.agentId);
    }
    if (agent === null) return null;
    await deps.repo.markReady(deps.owner, row.agentId);
    return agent;
  };

  /* UNIT_BOUNDARY_DESCRIPTION: the one rule for giving a person Dambledore. An Agent of theirs already under the assistant's name is adopted, and the record follows it; otherwise one is made, and the record settles which caller makes it — the primary key for a first one, a compare-and-set on the Agent it names for a later one. */
  const settle = async (
    row: AssistantRow | null,
  ): Promise<InfraAgent | null> => {
    const named = await namedAgent();
    if (named !== null) {
      await deps.repo.pointAt(deps.owner, named.id);
      return named;
    }
    let current = row;
    if (current === null) {
      const agentId = generateK8sName("agent");
      if (!(await deps.repo.claim(deps.owner, agentId))) return null;
      current = {
        owner: deps.owner,
        agentId,
        state: "creating",
        used: false,
        resetAt: null,
      };
    } else if (current.state === "ready") {
      const replacement = generateK8sName("agent");
      if (
        await deps.repo.replaceAgent(deps.owner, current.agentId, replacement)
      )
        current = { ...current, agentId: replacement, state: "creating" };
      else {
        const moved = await deps.repo.find(deps.owner);
        if (moved === null) return null;
        current = moved;
      }
    }
    return makeAgent(current);
  };

  const provision = async (): Promise<InfraAgent | null> => {
    if (!(await deps.enabled())) return null;
    if (!(await deps.admitted())) return null;
    const agent = await settle(await deps.repo.find(deps.owner));
    if (agent !== null) await deps.provisioned(created(agent));
    return agent;
  };

  const attempt = async (work: () => Promise<unknown>): Promise<void> => {
    try {
      await work();
    } catch (err) {
      getLogger().warn(
        { err, owner: deps.owner },
        "assistant.provision_failed",
      );
    }
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
        await deps.resetChecklist();
        // UNIT_BOUNDARY_DESCRIPTION: the person is a first-timer again, so a Dambledore they deleted or renamed away is made again, and one they still have is reused with its use forgotten.
        const agent = await settle(await deps.repo.find(deps.owner));
        await deps.repo.resetUsed(deps.owner);
        if (agent !== null) await deps.provisioned(created(agent));
      },
    },

    async ensure() {
      await attempt(async () => {
        // UNIT_BOUNDARY_DESCRIPTION: an install that pins the feature on gives each person one at their first admitted request, once: a ready record is what says they were given theirs, so a Dambledore they delete is not made again by a request — such an install has no switch, and the reset is their way to ask again. A record that is still `creating` is a create that never finished, which this request finishes.
        const row = await deps.repo.find(deps.owner);
        if (row?.state === "ready") return;
        await provision();
      });
    },

    async optIn() {
      await attempt(provision);
    },
  };
}
