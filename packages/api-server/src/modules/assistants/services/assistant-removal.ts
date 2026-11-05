import type { AgentsService } from "api-server-api";
import type { LockOutcome, OwnerLock } from "db";

import { getLogger } from "../../../core/logger.js";
import { assistantAgentId } from "../domain/agent-id.js";
import type { AssistantsRepository } from "../infrastructure/assistants-repository.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Turning the assistant off for one person deletes
 * their assistant and its data — the ordinary Agent delete, so its sessions,
 * files, grants, schedules and environment go the way any Agent's do — and then
 * forgets the record, so opting in again makes a **new** Agent under the next
 * incarnation with nothing initialized and nothing remembered. The Agent the
 * record renamed to free the reserved name is left exactly as it is: a person's
 * own Agent is never renamed back, and the notice that said so goes with the
 * record. It runs under the owner's provisioning lock, so it cannot interleave
 * with a create, and a person with no assistant is a no-op.
 */
export async function removeAssistant(deps: {
  repo: AssistantsRepository;
  agents: Pick<AgentsService, "delete">;
  withLock: OwnerLock["withLock"];
  owner: string;
}): Promise<LockOutcome<void>> {
  return deps.withLock(deps.owner, async () => {
    const row = await deps.repo.find(deps.owner);
    if (row === null) return;
    try {
      await deps.agents.delete(row.agentId);
    } catch (err) {
      // UNIT_BOUNDARY_DESCRIPTION: an Agent already gone is what the record's reset expects, so the removal goes on; any other failure is reported and the record is left as it was, so the next attempt tries again.
      getLogger().warn(
        { err, owner: deps.owner, agentId: row.agentId },
        "assistant.remove_failed",
      );
      throw err;
    }
    await deps.repo.forgetAll(
      deps.owner,
      row.agentId,
      assistantAgentId(deps.owner, row.incarnation + 1),
    );
  });
}
