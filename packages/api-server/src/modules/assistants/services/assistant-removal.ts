import type { AgentsService } from "api-server-api";
import type { LockOutcome, OwnerLock } from "db";

import { getLogger } from "../../../core/logger.js";
import { assistantAgentId } from "../domain/agent-id.js";
import type { AssistantsRepository } from "../infrastructure/assistants-repository.js";

/* UNIT_BOUNDARY_DESCRIPTION: how long a turn-off waits for the owner's provisioning lock to free. A create holds it for a moment; a worker paused on it is not going to finish, and the turn-off reports failure rather than leave a delete undone. */
const LOCK_WAIT_ATTEMPTS = 20;
const LOCK_WAIT_MS = 150;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one thing that deletes an assistant — a person
 * turning the feature off for themselves, after they confirmed it — and it unless
 * someone else says otherwise, because nothing else may destroy an assistant's
 * data. It is the ordinary Agent delete, so its sessions, files, grants,
 * schedules and environment go the way any Agent's do, and then the record is
 * forgotten: the next incarnation's Agent id, nothing initialized, never used,
 * and no rename record or notice. The Agent a rename made room with keeps its new
 * name — a person's own Agent is never renamed back.
 *
 * Everything is decided under the owner's provisioning lock, so it cannot
 * interleave with a create, and two things are re-checked there rather than
 * trusted from the request that asked: the record is still the one that request
 * read (another incarnation means somebody opted in again, and their assistant is
 * not this delete's), and the install still lets a person opt out at all (mode
 * `on` leaves nobody opted out, so a stale turn-off must not fire). `false` says
 * the delete did not happen: the caller keeps the switch on and says so.
 */
export async function removeAssistant(deps: {
  repo: AssistantsRepository;
  agents: Pick<AgentsService, "delete">;
  withLock: OwnerLock["withLock"];
  owner: string;
  /* UNIT_BOUNDARY_DESCRIPTION: the record the caller is removing, as it read it; null when the caller saw none. */
  expectedAgentId: string | null;
  /* UNIT_BOUNDARY_DESCRIPTION: whether the install still lets a person opt out — false in mode `on`, where everyone has the assistant. */
  optOutAllowed: () => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<LockOutcome<boolean>> {
  const remove = () =>
    deps.withLock(deps.owner, async (): Promise<boolean> => {
      if (!(await deps.optOutAllowed())) return false;
      const row = await deps.repo.find(deps.owner);
      if (row === null) return true;
      if (row.agentId !== deps.expectedAgentId) return false;
      try {
        await deps.agents.delete(row.agentId);
      } catch (err) {
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
      return true;
    });

  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt += 1) {
    const outcome = await remove();
    if (outcome.ran || attempt >= LOCK_WAIT_ATTEMPTS) return outcome;
    await sleep(LOCK_WAIT_MS);
  }
}
