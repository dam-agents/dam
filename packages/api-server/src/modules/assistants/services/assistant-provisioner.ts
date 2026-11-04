import type { AgentsService } from "api-server-api";
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
  admitted: () => Promise<boolean>;
  enabled: () => Promise<boolean>;
  agentOf: (agentId: string) => Promise<InfraAgent | null>;
  agents: Pick<AgentsService, "list" | "create" | "update">;
  enrolled: () => Promise<void>;
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

  const provisioned = async (row: AssistantRow, exists: boolean) => {
    if (exists) {
      await rename(row);
      await deps.agents.create({
        id: row.agentId,
        name: deps.assistantName,
        kind: "assistant",
        resume: true,
      });
      return;
    }
    await deps.enrolled();
    await rename(row);
    try {
      await deps.agents.create({
        id: row.agentId,
        name: deps.assistantName,
        kind: "assistant",
      });
    } catch (err) {
      // UNIT_BOUNDARY_DESCRIPTION: a replica that raced this one may have made the very same Agent, which is adoption rather than failure — but a create that failed for another reason must not be reported as done.
      if ((await deps.agentOf(row.agentId)) === null) throw err;
      await deps.agents.create({
        id: row.agentId,
        name: deps.assistantName,
        kind: "assistant",
        resume: true,
      });
    }
  };

  return {
    async ensure() {
      try {
        if (!(await deps.admitted())) return;
        if (!(await deps.enabled())) return;
        let row = await deps.repo.find(deps.ownName);
        if (row === null) {
          const started = await deps.repo.start(
            deps.ownName,
            assistantAgentId(deps.ownName, 1),
          );
          if (!started) return;
          row = await deps.repo.find(deps.ownName);
          if (row === null) return;
        }
        const exists = (await deps.agentOf(row.agentId)) !== null;
        if (exists && row.state === "ready") return;
        if (!exists && row.state !== "creating") {
          const moved = await deps.repo.nextIncarnation(
            deps.ownName,
            row.agentId,
            assistantAgentId(deps.ownName, row.incarnation + 1),
          );
          if (!moved) return;
          row = await deps.repo.find(deps.ownName);
          if (row === null) return;
        }
        await provisioned(row, exists);
        await deps.repo.markReady(deps.ownName, row.agentId);
      } catch (err) {
        getLogger().warn(
          { err, owner: deps.ownName },
          "assistant.provision_failed",
        );
      }
    },
  };
}
