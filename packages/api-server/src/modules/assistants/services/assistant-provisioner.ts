import {
  AGENT_INIT_STEPS,
  type AgentInitStep,
  type AgentsService,
  assistantInstructions,
} from "api-server-api";
import { avatarCharacter } from "api-server-api/avatar/svg";
import type { LockOutcome, OwnerLock } from "db";
import { emit, EventType } from "../../../events.js";
import type { InfraAgent } from "../../agents/infrastructure/agent-mappers.js";
import { getLogger } from "../../../core/logger.js";
import { assistantAgentId } from "../domain/agent-id.js";
import type {
  AssistantRow,
  AssistantsRepository,
} from "../infrastructure/assistants-repository.js";

export interface AssistantProvisioner {
  ensure(): Promise<void>;
}

/** UNIT_BOUNDARY_DESCRIPTION: the name the owner's clashing Agent is renamed to: the reserved name with the marker in brackets, then a number when that too is taken. */
export function freedName(
  assistantName: string,
  taken: ReadonlySet<string>,
): string {
  const base = `${assistantName} (yours)`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Gives the owner exactly one assistant Agent, at the
 * first authenticated request the install's mode lets them have one, and finishes
 * it on later ones. The Agent's id is derived from the owner and the row's
 * incarnation, so every replica computes the same one and the store's create is
 * the mutex: a create that loses is refused by the primary key and adopts what is
 * there. `ready` is written only after the Agent and all of its initialization
 * returned, so a request that dies half-way leaves a record the next request
 * finishes, and a failure is logged rather than hidden. When the Agent was
 * deleted after it was ready, the row moves to its next incarnation, so the
 * replacement has a new id and nothing keyed by the old one can reach it.
 * Before the first create it enrols the owner in the Getting Started checklist,
 * so a user who has never been here is read as new rather than as an owner who
 * already has an Agent — the assistant then counts as their first. An Agent of
 * theirs already holding the reserved name is renamed once; the rename is
 * recorded before it happens and completed only when it lands.
 */
export function createAssistantProvisioner(deps: {
  repo: AssistantsRepository;
  ownName: string;
  assistantName: string;
  brandName: string;
  admitted: () => Promise<boolean>;
  enabled: () => Promise<boolean>;
  agentOf: (agentId: string) => Promise<InfraAgent | null>;
  agents: Pick<AgentsService, "list" | "create" | "update">;
  enrolled: () => Promise<void>;
  /* UNIT_BOUNDARY_DESCRIPTION: what the checklist learns from this Agent the platform made, before it is announced like any other. */
  provisioned: (agent: InfraAgent) => Promise<void>;
  withLock: OwnerLock["withLock"];
}): AssistantProvisioner {
  const rename = async (row: AssistantRow): Promise<void> => {
    const recorded = row.renamed;
    if (recorded !== null) {
      if (recorded.done) return;
      const agent = await deps.agentOf(recorded.agentId);
      if (agent === null) {
        await deps.repo.clearRename(row.owner, row.agentId);
        return;
      }
      if (agent.name === recorded.to) {
        await deps.repo.completeRename(row.owner, row.agentId);
        return;
      }
      // UNIT_BOUNDARY_DESCRIPTION: an Agent the person renamed since is theirs to name; the record is dropped rather than renaming over them.
      if (agent.name !== recorded.from) {
        await deps.repo.clearRename(row.owner, row.agentId);
        return;
      }
      await deps.agents.update({ id: recorded.agentId, name: recorded.to });
      await deps.repo.completeRename(row.owner, row.agentId);
      return;
    }
    const others = await deps.agents.list();
    const clash = others.find(
      (a) => a.name === deps.assistantName && a.kind !== "assistant",
    );
    if (clash === undefined) return;
    const to = freedName(
      deps.assistantName,
      new Set(others.map((a) => a.name)),
    );
    await deps.repo.recordRename(row.owner, row.agentId, {
      agentId: clash.id,
      from: deps.assistantName,
      to,
      done: false,
    });
    await deps.agents.update({ id: clash.id, name: to });
    await deps.repo.completeRename(row.owner, row.agentId);
  };

  /* UNIT_BOUNDARY_DESCRIPTION: the row's recorded steps are what a retry skips, and each step is recorded as it lands — before the next one runs — so a create that dies half-way never re-applies an initialization the owner may have changed since. */
  const initOf = (row: AssistantRow) => ({
    initDone: row.steps,
    onInitStep: (step: AgentInitStep) =>
      deps.repo.markInitStep(row.owner, row.agentId, step),
  });

  const instructions = assistantInstructions({
    assistantName: deps.assistantName,
    brandName: deps.brandName,
  });

  const ensureAgent = async (row: AssistantRow, exists: boolean) => {
    if (exists) {
      await rename(row);
      await deps.agents.create({
        id: row.agentId,
        name: deps.assistantName,
        kind: "assistant",
        instructions,
        resume: true,
        ...initOf(row),
      });
      return;
    }
    await deps.enrolled();
    await rename(row);
    try {
      // UNIT_BOUNDARY_DESCRIPTION: a store write that makes the Agent has initialized nothing, whatever the row recorded for the Agent it replaces: the steps start empty.
      await deps.agents.create({
        id: row.agentId,
        name: deps.assistantName,
        kind: "assistant",
        instructions,
        initDone: [],
        onInitStep: initOf(row).onInitStep,
      });
    } catch (err) {
      // UNIT_BOUNDARY_DESCRIPTION: a replica that raced this one may have made the very same Agent, which is adoption rather than failure — but a create that failed for another reason must not be reported as done.
      if ((await deps.agentOf(row.agentId)) === null) throw err;
      const current = await deps.repo.find(row.owner);
      await deps.agents.create({
        id: row.agentId,
        name: deps.assistantName,
        kind: "assistant",
        instructions,
        resume: true,
        ...initOf(current ?? row),
      });
    }
  };

  /* UNIT_BOUNDARY_DESCRIPTION: everything one owner's provisioning does happens under that owner's lock, so no second worker can rewrite the initialization behind this one, and a lock held elsewhere means this request simply leaves it to that worker. */
  const once = async (): Promise<LockOutcome<void>> => {
    let row = await deps.repo.find(deps.ownName);
    if (row === null) {
      const started = await deps.repo.start(
        deps.ownName,
        assistantAgentId(deps.ownName, 1),
      );
      if (!started) return { ran: true, value: undefined };
      row = await deps.repo.find(deps.ownName);
      if (row === null) return { ran: true, value: undefined };
    }
    const exists = (await deps.agentOf(row.agentId)) !== null;
    const ready = exists && row.state === "ready";
    /* UNIT_BOUNDARY_DESCRIPTION: a ready row is finished only against the steps this version defines, so a step added after the Agent was made reaches it once — and the hot path pays one comparison against a list of four. */
    const recorded: readonly AgentInitStep[] = row.steps;
    const upToDate =
      ready && AGENT_INIT_STEPS.every((step) => recorded.includes(step));
    if (upToDate) return { ran: true, value: undefined };
    if (!exists && row.state !== "creating") {
      const moved = await deps.repo.nextIncarnation(
        deps.ownName,
        row.agentId,
        assistantAgentId(deps.ownName, row.incarnation + 1),
      );
      if (!moved) return { ran: true, value: undefined };
      row = await deps.repo.find(deps.ownName);
      if (row === null) return { ran: true, value: undefined };
    }
    await ensureAgent(row, exists);
    await deps.repo.markReady(deps.ownName, row.agentId);
    const agent = await deps.agentOf(row.agentId);
    if (agent === null) return { ran: true, value: undefined };
    /* UNIT_BOUNDARY_DESCRIPTION: a ready row catching up on a step it never had was announced when it became ready, so it is announced no second time. */
    if (ready) return { ran: true, value: undefined };
    await deps.provisioned(agent);
    if (exists)
      emit({
        type: EventType.AgentCreated,
        agentId: agent.id,
        ownerSub: agent.owner ?? deps.ownName,
        character: avatarCharacter(agent.spec.avatar, deps.ownName, agent.name),
      });
    return { ran: true, value: undefined };
  };

  return {
    async ensure() {
      if (!(await deps.admitted())) return;
      if (!(await deps.enabled())) return;
      try {
        // UNIT_BOUNDARY_DESCRIPTION: the answer that decides a create is read again inside the owner's lock, because a turn-off stores the switch there too: an answer read before the lock can be as old as the request that carried it, and provisioning a replacement for someone who has just switched the assistant off would leave one no request ever removes.
        await deps.withLock(deps.ownName, async () => {
          if (!(await deps.enabled())) return;
          await once();
        });
      } catch (err) {
        getLogger().warn(
          { err, owner: deps.ownName },
          "assistant.provision_failed",
        );
      }
    },
  };
}
