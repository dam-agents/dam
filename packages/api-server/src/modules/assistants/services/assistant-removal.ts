import type { AgentsService } from "api-server-api";
import type { LockOutcome, OwnerLock } from "db";

import { getLogger } from "../../../core/logger.js";
import { assistantAgentId } from "../domain/agent-id.js";
import type { AssistantsRepository } from "../infrastructure/assistants-repository.js";

/* UNIT_BOUNDARY_DESCRIPTION: how long a turn-off waits for the owner's provisioning lock to free. A create holds it for a moment; a worker paused on it is not going to finish, and the turn-off reports failure rather than leave a delete undone. */
const LOCK_WAIT_ATTEMPTS = 20;
const LOCK_WAIT_MS = 150;

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
  /* UNIT_BOUNDARY_DESCRIPTION: how many times to ask for the lock before giving up — the caller's switch waits a moment, the reconciliation on a later request asks once and leaves the rest to the next one. */
  lockAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<LockOutcome<void>> {
  const remove = () =>
    deps.withLock(deps.owner, async () => {
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

  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempts = Math.max(1, deps.lockAttempts ?? LOCK_WAIT_ATTEMPTS);
  for (let attempt = 1; ; attempt += 1) {
    const outcome = await remove();
    if (outcome.ran || attempt >= attempts) return outcome;
    await sleep(LOCK_WAIT_MS);
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the reconciliation a later request runs for a person
 * the feature is off for: a turn-off that could not take the lock leaves their
 * assistant behind, and this finishes that delete. One attempt per request, so a
 * lock held by a live worker costs nothing and the next request tries again.
 * A person with no assistant record is a no-op.
 */
export async function reconcileOptOut(
  deps: Parameters<typeof removeAssistant>[0],
): Promise<void> {
  const outcome = await removeAssistant({ ...deps, lockAttempts: 1 });
  if (!outcome.ran)
    getLogger().info(
      { owner: deps.owner },
      "assistant.opt_out_reconcile_deferred",
    );
}
