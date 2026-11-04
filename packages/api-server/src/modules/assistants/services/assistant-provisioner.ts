import type { Agent, AgentsService } from "api-server-api";
import type { InfraAgent } from "../../agents/infrastructure/agent-mappers.js";
import { getLogger } from "../../../core/logger.js";
import type {
  AssistantsRepository,
  AssistantRow,
} from "../infrastructure/assistants-repository.js";

export interface AssistantProvisioner {
  ensure(): Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: how long a claim left behind by a replica that died
 * mid-provisioning blocks another attempt. Short enough that a person's next
 * request repairs it, long enough that a slow create is not duplicated.
 */
const CLAIM_TTL_MS = 60_000;

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
 * first authenticated request the install's mode lets them have one, and repairs
 * it on later ones. The row is the record: it is written with a pre-chosen Agent
 * identity before anything external happens, so a crash, a failed create or an
 * operator's delete leaves a record the next request finishes with that same
 * Agent rather than a second one, and two replicas that race it converge because
 * one of them wins the claim and the other adopts the Agent already there.
 * Before the create it enrols the owner in the Getting Started checklist, so a
 * user who has never been here is read as new rather than as an owner who
 * already has an Agent — the assistant then counts as their first. An Agent of
 * theirs already holding the reserved name is renamed once; the rename is
 * recorded before it happens, so a create that fails afterwards cannot lose the
 * news.
 */
export function createAssistantProvisioner(deps: {
  repo: AssistantsRepository;
  ownName: string;
  assistantName: string;
  /* UNIT_BOUNDARY_DESCRIPTION: whether the person may have anything at all yet — the Terms of Use accepted, which a closed sign-up never lets them do. Read before anything is created, so no Agent appears for an account the install has not admitted. */
  admitted: () => Promise<boolean>;
  enabled: () => Promise<boolean>;
  agentOf: (agentId: string) => Promise<InfraAgent | null>;
  agents: Pick<AgentsService, "list" | "create" | "update">;
  enrolled: () => Promise<void>;
  newAgentId: () => string;
}): AssistantProvisioner {
  const settled = async (row: AssistantRow | null): Promise<boolean> => {
    if (row?.state !== "ready") return false;
    return (await deps.agentOf(row.agentId)) !== null;
  };

  const renamed = async (
    others: readonly Agent[],
    row: AssistantRow,
  ): Promise<void> => {
    const recorded = row.renamed;
    if (recorded !== null) {
      const agent = await deps.agentOf(recorded.agentId);
      if (agent === null) {
        await deps.repo.clearRename(row.owner, row.agentId);
        return;
      }
      // UNIT_BOUNDARY_DESCRIPTION: the record is written before the rename, so a retry finishes it.
      if (agent.name !== recorded.to)
        await deps.agents.update({ id: recorded.agentId, name: recorded.to });
      return;
    }
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
    });
    await deps.agents.update({ id: clash.id, name: to });
  };

  const ensureAgent = async (row: AssistantRow): Promise<void> => {
    if ((await deps.agentOf(row.agentId)) !== null) return;
    await deps.enrolled();
    await renamed(await deps.agents.list(), row);
    try {
      await deps.agents.create({
        id: row.agentId,
        name: deps.assistantName,
        kind: "assistant",
      });
    } catch (err) {
      // UNIT_BOUNDARY_DESCRIPTION: a replica that raced this one may have made the very same Agent, which is adoption rather than failure.
      if ((await deps.agentOf(row.agentId)) === null) throw err;
    }
  };

  return {
    async ensure() {
      try {
        if (!(await deps.admitted())) return;
        if (!(await deps.enabled())) return;
        const current = await deps.repo.find(deps.ownName);
        if (await settled(current)) return;
        if (
          current !== null &&
          !(await deps.repo.takeOver(
            deps.ownName,
            current.agentId,
            CLAIM_TTL_MS,
          ))
        )
          return;
        let row = current;
        if (row === null) {
          if (!(await deps.repo.reserve(deps.ownName, deps.newAgentId())))
            return;
          row = await deps.repo.find(deps.ownName);
          if (row === null) return;
        }
        await ensureAgent(row);
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
