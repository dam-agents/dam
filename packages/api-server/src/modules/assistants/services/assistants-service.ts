import {
  type AgentsService,
  type AssistantFirstResultInput,
  type AssistantsService,
  assistantInstructions,
  type FirstResultKind,
  type GettingStartedTask,
} from "api-server-api";

import { getLogger } from "../../../core/logger.js";
import type { DbTx } from "db";
import type { Unlock } from "../../getting-started/domain/unlocks.js";
import { emit, EventType } from "../../../events.js";
import type { InfraAgent } from "../../agents/infrastructure/agent-mappers.js";
import { generateK8sName } from "../../agents/infrastructure/configmap-mappers.js";
import type { XactTxLock } from "../../../core/xact-lock.js";
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
  /* UNIT_BOUNDARY_DESCRIPTION: how the checklist counts a task the assistant did for the person — done and seen, written on this caller's own transaction — and the unlock it wrote, which is announced after that transaction commits. */
  recordTaskIn: (tx: DbTx, task: GettingStartedTask) => Promise<Unlock | null>;
  /* UNIT_BOUNDARY_DESCRIPTION: the checklist's own reset, on this caller's transaction, so the first result and the checklist it belongs to change together. */
  resetChecklistIn: (tx: DbTx) => Promise<void>;
  /* UNIT_BOUNDARY_DESCRIPTION: one per-owner transaction around the first result, taken by its report and by every reset — what a report reads is what its writes settle against. */
  firstResultLock: XactTxLock;
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
      /* UNIT_BOUNDARY_DESCRIPTION: the account's cohort is settled here, at the one moment the platform first makes it an assistant: an Agent already in its list is one it had before this. It is never read again — a delete, a reset or a new assistant leaves it as it was. */
      const legacy = (await deps.agents.list()).length > 0;
      if (!(await deps.repo.claim(deps.owner, agentId, legacy)))
        return { agent: await joinOrFinish(forMs), made: false };
      return {
        agent: await makeAgent({
          owner: deps.owner,
          agentId,
          state: "creating",
          legacy,
          used: false,
          resetAt: null,
          firstResult: null,
          epoch: 0,
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

  /* UNIT_BOUNDARY_DESCRIPTION: which checklist task a first result finishes: the two kinds the checklist has a task for, and none for a saved knowledge base, which the checklist never had an item for. */
  const taskOf = (
    kind: AssistantFirstResultInput["kind"],
  ): GettingStartedTask | null =>
    kind === "schedule"
      ? "create-schedule"
      : kind === "artifact"
        ? "create-artifact"
        : null;

  /**
   * UNIT_BOUNDARY_DESCRIPTION: the first result's one critical section, shared by
   * the report and by every reset. Inside the per-owner transaction: the record is
   * read with its row locked; a report with no result yet claims one; the checklist
   * tick and the completion mark follow, so nothing is ticked or marked by two
   * callers and no reset can land between the claim and them. A record already
   * completed is answered, never re-announced, and an uncompleted one — a caller
   * that died — is finished here.
   * The event goes out after the transaction commits, and only from the call that
   * marked the result completed: at most once, never twice. A crash between the
   * commit and the emit loses it, which is accepted — the seam has no consumer yet.
   */
  const runFirstResult = async (
    input: {
      kind: AssistantFirstResultInput["kind"];
      ref: string | null;
    } | null,
  ): Promise<{
    result: AssistantRow["firstResult"];
    announce: {
      kind: AssistantFirstResultInput["kind"];
      ref: string | null;
      epoch: number;
    } | null;
    unlock: Unlock | null;
  }> =>
    deps.firstResultLock(deps.owner, async (tx) => {
      const row = await deps.repo.firstResultIn(tx, deps.owner);
      if (row === null) return { result: null, announce: null, unlock: null };
      let result = row.firstResult;
      if (result === null) {
        if (input === null)
          return { result: null, announce: null, unlock: null };
        await deps.repo.claimFirstResultIn(
          tx,
          deps.owner,
          input.kind,
          input.ref,
        );
        /* UNIT_BOUNDARY_DESCRIPTION: the claim is read back from the row rather than rebuilt here, so the moment it records is the store's own. */
        result =
          (await deps.repo.firstResultIn(tx, deps.owner))?.firstResult ?? null;
        if (result === null)
          return { result: null, announce: null, unlock: null };
      }
      if (result.completed) return { result, announce: null, unlock: null };
      const task = taskOf(result.kind);
      /* UNIT_BOUNDARY_DESCRIPTION: the tick is written on this transaction, so the checklist and the completion land together; its unlock is announced by the caller once the transaction commits. */
      const unlock = task === null ? null : await deps.recordTaskIn(tx, task);
      await deps.repo.completeFirstResultIn(tx, deps.owner);
      return {
        result: { ...result, completed: true },
        announce: { kind: result.kind, ref: result.ref, epoch: row.epoch },
        unlock,
      };
    });

  const announce = (
    first: {
      kind: AssistantFirstResultInput["kind"];
      ref: string | null;
      epoch: number;
    },
    unlock: Unlock | null,
  ): void => {
    if (unlock !== null)
      emit({
        type: EventType.AvatarUnlocked,
        ownerSub: deps.owner,
        task: unlock.task,
        character: unlock.character,
      });
    emit({
      type: EventType.AssistantFirstResultRecorded,
      owner: deps.owner,
      kind: first.kind,
      ref: first.ref,
      epoch: first.epoch,
    });
  };

  /* UNIT_BOUNDARY_DESCRIPTION: the answer the UI and the CLI read: the recorded result, or none. */
  const answer = (
    result: AssistantRow["firstResult"],
  ): { kind: FirstResultKind; ref: string | null; at: string } | null =>
    result === null
      ? null
      : { kind: result.kind, ref: result.ref, at: result.at.toISOString() };

  return {
    assistants: {
      async recordFirstResult(input) {
        const {
          result,
          announce: news,
          unlock,
        } = await runFirstResult({
          kind: input.kind,
          ref: input.ref ?? null,
        });
        if (news !== null) announce(news, unlock);
        return answer(result);
      },

      async state() {
        const row = await deps.repo.find(deps.owner);
        return row === null
          ? null
          : {
              agentId: row.agentId,
              legacy: row.legacy,
              used: row.used,
              resetAt: row.resetAt?.toISOString() ?? null,
              ready: row.state === "ready",
              firstResult:
                row.firstResult === null
                  ? null
                  : {
                      kind: row.firstResult.kind,
                      ref: row.firstResult.ref,
                      at: row.firstResult.at.toISOString(),
                    },
            };
      },

      async resetOnboarding() {
        // UNIT_BOUNDARY_DESCRIPTION: the one onboarding reset. The checklist starts over for everyone, and a person the feature is on for is a first-timer in their assistant too — one they deleted is made again when nothing of theirs carries the name, one they still have is reused with its use forgotten. A person it is off for gets the checklist alone, and nothing of the assistant's is touched or refused — the first result aside, which is the checklist's own state and goes with it either way.
        /* UNIT_BOUNDARY_DESCRIPTION: the reset takes the first result's own lock, so a report inside it finishes before this clears, and one that started after it reads a record with no result and a later epoch. The checklist restarts on the same transaction, so no tick lands on the fresh one and neither change commits without the other; its own event leaves after the commit. */
        await deps.firstResultLock(deps.owner, async (tx) => {
          await deps.repo.clearFirstResultIn(tx, deps.owner);
          await deps.resetChecklistIn(tx);
        });
        emit({ type: EventType.GettingStartedReset, ownerSub: deps.owner });
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
