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
  /* UNIT_BOUNDARY_DESCRIPTION: gives this person Dambledore at their first admitted request, for an install that pins the feature on and has no switch to offer them. It happens once per person, through the record: a Dambledore they delete stays deleted until they ask for one. Nothing is made when they own an Agent under the name; a failure is logged rather than raised, since a request is not the place to report it. */
  ensure: () => Promise<void>;
  /* UNIT_BOUNDARY_DESCRIPTION: gives this person Dambledore when they turn the feature on, and reports a failure to that caller — the switch they flipped is the one place a failure has a person to tell. Nothing is made for a person who owns an Agent under the assistant's name. */
  optIn: () => Promise<void>;
}

/* UNIT_BOUNDARY_DESCRIPTION: how long a reset or a switch waits for a create another caller holds. Creating an Agent writes one store row, so the wait is generous against a slow store, and bounded so a claim nobody holds cannot hang the reset forever. */
const DEFAULT_WAIT_MS = 5_000;
const DEFAULT_POLL_MS = 150;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Agent the platform makes under its brand's
 * assistant name, and the only two things anyone may ask of it here. It is an
 * ordinary Agent, created through the ordinary create, so everything the
 * catalogue offers it offers the assistant: renaming, deleting, disabling,
 * editors, channels, a different model.
 * The record names the Agent the platform made, and only ever one of those: it is
 * what the greeting, the landing and the reset speak about, so an Agent the
 * person made under the same name is not it, and nothing is made beside that name
 * either.
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
  /* UNIT_BOUNDARY_DESCRIPTION: how long a reset or a switch waits for a create another caller holds, and how often it looks. A request waits not at all, since it has a page to answer. */
  waitMs?: number;
  pollMs?: number;
}): AssistantProvisioning {
  const waitMs = deps.waitMs ?? DEFAULT_WAIT_MS;
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
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

  /* UNIT_BOUNDARY_DESCRIPTION: whether any Agent of the person's carries the assistant's name, matched exactly and case-sensitively and read from the store rather than from anything remembered — the name belongs to whoever holds it at this moment, and the platform never makes a second one under it. */
  const nameTaken = async (): Promise<boolean> =>
    (await deps.agents.list()).some(
      (agent) => agent.name === deps.assistantName,
    );

  /* UNIT_BOUNDARY_DESCRIPTION: waits for the Agent a create in flight will make, so a caller that lost the claim finishes on the same Agent rather than on nothing. Bounded by the wait it is given, and zero for a request, which has a page to answer. */
  const awaitSettled = async (forMs: number): Promise<InfraAgent | null> => {
    const deadline = Date.now() + forMs;
    for (;;) {
      const row = await deps.repo.find(deps.owner);
      if (row?.state === "ready") {
        const agent = await deps.agentOf(row.agentId);
        if (agent !== null) return agent;
      }
      if (Date.now() >= deadline) return null;
      await sleep(pollMs);
    }
  };

  /* UNIT_BOUNDARY_DESCRIPTION: what a caller that lost the claim does: wait for the Agent the winner is making, and finish the claim itself only when nobody does — so a reset lands on the one Agent instead of returning empty-handed, and a claim left by a create that died is not stranded. */
  const joinOrFinish = async (forMs: number): Promise<InfraAgent | null> => {
    const joined = await awaitSettled(forMs);
    if (joined !== null) return joined;
    const row = await deps.repo.find(deps.owner);
    return row?.state === "creating" ? makeAgent(row) : null;
  };

  /* UNIT_BOUNDARY_DESCRIPTION: makes the Agent the record already names, once. Every caller asks for the same id, so the store settles which of them makes it; one whose create was refused reads that Agent back and adopts it, and one whose create failed for any other reason reports the failure rather than hiding it. */
  const makeAgent = async (row: AssistantRow): Promise<InfraAgent | null> => {
    let agent = await deps.agentOf(row.agentId);
    if (agent === null) {
      try {
        await create(row.agentId);
      } catch (err) {
        const joined = await deps.agentOf(row.agentId);
        if (joined === null) throw err;
        return joined;
      }
      agent = await deps.agentOf(row.agentId);
    }
    if (agent === null) return null;
    await deps.repo.markReady(deps.owner, row.agentId);
    return agent;
  };

  /**
   * UNIT_BOUNDARY_DESCRIPTION: the one rule for giving a person Dambledore. The
   * Agent the record names is theirs — renamed, disabled or asleep, it is still
   * the assistant — and while it is there nothing is made. Its Agent gone, one is
   * made only when no Agent of theirs carries the name; then the record settles
   * which caller makes it, by its primary key for a first one and by a
   * compare-and-set on the Agent it names for a later one, and a caller that loses
   * waits for the winner's Agent rather than making a second.
   */
  const settle = async (forMs: number): Promise<InfraAgent | null> => {
    const row = await deps.repo.find(deps.owner);
    if (row !== null) {
      const mine = await deps.agentOf(row.agentId);
      if (mine !== null) return mine;
    }
    if (await nameTaken()) return null;
    if (row === null) {
      const agentId = generateK8sName("agent");
      if (!(await deps.repo.claim(deps.owner, agentId)))
        return joinOrFinish(forMs);
      return makeAgent({
        owner: deps.owner,
        agentId,
        state: "creating",
        used: false,
        resetAt: null,
      });
    }
    // UNIT_BOUNDARY_DESCRIPTION: a claim: another caller's create in flight, or one that died.
    if (row.state === "creating") return joinOrFinish(forMs);
    const replacement = generateK8sName("agent");
    if (!(await deps.repo.replaceAgent(deps.owner, row.agentId, replacement)))
      return joinOrFinish(forMs);
    return makeAgent({ ...row, agentId: replacement, state: "creating" });
  };

  const provision = async (forMs: number): Promise<InfraAgent | null> => {
    if (!(await deps.enabled())) return null;
    if (!(await deps.admitted())) return null;
    const agent = await settle(forMs);
    if (agent !== null) await deps.provisioned(created(agent));
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
        await deps.resetChecklist();
        // UNIT_BOUNDARY_DESCRIPTION: the person is a first-timer again, so a Dambledore they deleted is made again — when nothing of theirs carries the name — and one they still have is reused with its use forgotten.
        const agent = await settle(waitMs);
        await deps.repo.resetUsed(deps.owner);
        if (agent !== null) await deps.provisioned(created(agent));
      },
    },

    async ensure() {
      try {
        // UNIT_BOUNDARY_DESCRIPTION: a ready record is what says a pinned-on person was given theirs, so a Dambledore they delete is not made again by a request — such an install has no switch, and the reset is their way to ask again. A record still `creating` is a create that never finished, which this request finishes.
        const row = await deps.repo.find(deps.owner);
        if (row?.state === "ready") return;
        await provision(0);
      } catch (err) {
        getLogger().warn(
          { err, owner: deps.owner },
          "assistant.provision_failed",
        );
      }
    },

    async optIn() {
      await provision(waitMs);
    },
  };
}
