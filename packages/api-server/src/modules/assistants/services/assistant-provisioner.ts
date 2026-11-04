import type { Agent, AgentsService } from "api-server-api";
import { getLogger } from "../../../core/logger.js";
import type {
  AssistantsRepository,
  Provisioned,
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
 * first authenticated request the install's mode lets them have one. The row is
 * the one-per-owner record: the cheap answer reads it outside the lock and stops,
 * and the answer that has work to do reads it again inside the per-owner lock, so
 * an owner who is already served is left alone and one whose Agent disappeared
 * (an operator deleted it) gets a new one. Before the create it enrols the owner
 * in the Getting Started checklist, so a user who has never been here is read as
 * new rather than as an owner who already has an Agent — the assistant then
 * counts as their first. An Agent of theirs already holding the reserved name is
 * renamed once, and the news is recorded on the row.
 */
export function createAssistantProvisioner(deps: {
  repo: AssistantsRepository;
  ownName: string;
  assistantName: string;
  enabled: () => Promise<boolean>;
  agentExists: (agentId: string) => Promise<boolean>;
  agents: Pick<AgentsService, "list" | "create" | "update">;
  enrolled: () => Promise<void>;
}): AssistantProvisioner {
  const renamed = async (
    others: readonly Agent[],
  ): Promise<Provisioned["renamed"]> => {
    const clash = others.find(
      (a) => a.name === deps.assistantName && a.kind !== "assistant",
    );
    if (clash === undefined) return undefined;
    const to = freedName(
      deps.assistantName,
      new Set(others.map((a) => a.name)),
    );
    const updated = await deps.agents.update({ id: clash.id, name: to });
    if (updated === null) return undefined;
    return { agentId: clash.id, from: deps.assistantName, to };
  };

  return {
    async ensure() {
      try {
        if (!(await deps.enabled())) return;
        const current = await deps.repo.find(deps.ownName);
        if (current?.agentId && (await deps.agentExists(current.agentId)))
          return;
        await deps.repo.provision(deps.ownName, async (held) => {
          if (held?.agentId && (await deps.agentExists(held.agentId)))
            return null;
          await deps.enrolled();
          const rename = await renamed(await deps.agents.list());
          const agent = await deps.agents.create({
            name: deps.assistantName,
            kind: "assistant",
          });
          return { agentId: agent.id, ...(rename ? { renamed: rename } : {}) };
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
