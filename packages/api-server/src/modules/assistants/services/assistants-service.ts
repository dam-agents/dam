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
  /* UNIT_BOUNDARY_DESCRIPTION: the owner's Connection that drives this install, made if they hold none, which an Agent the platform creates is created holding — so the person's own assistant can act for them on this install. Null where the install cannot have one. The platform's path: the flag that offers that Connection to people does not apply to it. */
  damConnection: () => Promise<string | null>;
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
    const dam = await damConnectionOrNull();
    await deps.agents.create({
      id: agentId,
      name: deps.assistantName,
      instructions: assistantInstructions({
        assistantName: deps.assistantName,
        brandName: deps.brandName,
      }),
      ...(dam !== null
        ? { connectionIds: [dam], platformGrants: true as const }
        : {}),
    });
  };

  /* UNIT_BOUNDARY_DESCRIPTION: whether any Agent of the person's carries the assistant's name, matched exactly and case-sensitively and read from the store rather than from anything remembered — the name belongs to whoever holds it at this moment, and the platform never makes a second one under it. */
  const nameTaken = async (): Promise<boolean> =>
    (await deps.agents.list()).some(
      (agent) => agent.name === deps.assistantName,
    );

  /* UNIT_BOUNDARY_DESCRIPTION: the assistant is made with or without its Connection: an install that cannot have one, or a key the platform could not mint, must not cost the person the Agent itself. */
  const damConnectionOrNull = async (): Promise<string | null> => {
    try {
      return await deps.damConnection();
    } catch (err) {
      getLogger().warn(
        { err, owner: deps.owner },
        "assistant.dam_connection_failed",
      );
      return null;
    }
  };

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

  /* UNIT_BOUNDARY_DESCRIPTION: makes the Agent the record already names, and finishes one an earlier attempt left half-made. A row still `creating` says the create never reported success, so it is asked for again even when its Agent is already there: the create resumes that Agent rather than failing on it, and every step it repeats — the instructions, the grants, the Connection — is written to be written again. Only a create that returned finishes the record: one that failed leaves it `creating`, so the steps it never reached run on the next request instead of being skipped as if they had. The bookkeeping comes before the record is marked ready, so a checklist or unlock that failed is retried with it. */
  const makeAgent = async (row: AssistantRow): Promise<InfraAgent | null> => {
    let agent = await deps.agentOf(row.agentId);
    if (agent === null || row.state !== "ready") {
      await create(row.agentId);
      agent = await deps.agentOf(row.agentId);
    }
    if (agent === null) return null;
    if (row.state !== "ready") {
      await deps.provisioned(created(agent));
      await deps.repo.markReady(deps.owner, row.agentId);
    }
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
  const settle = async (
    forMs: number,
  ): Promise<{ agent: InfraAgent | null; made: boolean }> => {
    const row = await deps.repo.find(deps.owner);
    /* UNIT_BOUNDARY_DESCRIPTION: a record that is `ready` and whose Agent is there is an assistant made; one whose Agent exists but whose record still says `creating` is a create that stopped on its bookkeeping, so it is finished rather than handed over half-made — and before the name is read, since that half-made Agent is the one holding it. */
    if (row !== null && row.state === "ready") {
      const mine = await deps.agentOf(row.agentId);
      if (mine !== null) return { agent: mine, made: false };
    }
    if (row !== null && row.state === "creating")
      return { agent: await joinOrFinish(forMs), made: false };
    if (await nameTaken()) return { agent: null, made: false };
    if (row === null) {
      const agentId = generateK8sName("agent");
      if (!(await deps.repo.claim(deps.owner, agentId)))
        return { agent: await joinOrFinish(forMs), made: false };
      return {
        agent: await makeAgent({
          owner: deps.owner,
          agentId,
          state: "creating",
          used: false,
          resetAt: null,
        }),
        made: true,
      };
    }
    const replacement = generateK8sName("agent");
    if (!(await deps.repo.replaceAgent(deps.owner, row.agentId, replacement)))
      return { agent: await joinOrFinish(forMs), made: false };
    return {
      agent: await makeAgent({
        ...row,
        agentId: replacement,
        state: "creating",
      }),
      made: true,
    };
  };

  const provision = async (forMs: number): Promise<InfraAgent | null> => {
    if (!(await deps.enabled())) return null;
    if (!(await deps.admitted())) return null;
    return (await settle(forMs)).agent;
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
              ready: row.state === "ready",
            };
      },

      async resetOnboarding() {
        // UNIT_BOUNDARY_DESCRIPTION: the one onboarding reset. The checklist starts over for everyone, and a person the feature is on for is a first-timer in their assistant too — one they deleted is made again when nothing of theirs carries the name, one they still have is reused with its use forgotten. A person it is off for gets the checklist alone, and nothing of the assistant's is touched or refused.
        await deps.resetChecklist();
        if (!(await deps.enabled())) return;
        /* UNIT_BOUNDARY_DESCRIPTION: an Agent the reset has to make is recorded by the create itself, before its record reads ready; one the reset reuses is recorded here, since nothing created it this time. */
        const { agent, made } = await settle(waitMs);
        await deps.repo.resetUsed(deps.owner);
        if (!made && agent !== null) await deps.provisioned(created(agent));
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
