import type { GettingStartedTask } from "api-server-api";
import type { AvatarCharacter } from "api-server-api/avatar/svg";
import type { DbTx } from "db";

import { chooseUnlock, type Unlock } from "../domain/unlocks.js";
import type { GettingStartedRepository } from "../infrastructure/getting-started-repository.js";
import type { UnlockRecorder } from "./unlock-recorder.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: An Agent the platform made for a person finishes
 * the checklist's first task for them, so it is recorded as theirs — and left
 * **unseen**, because the person meets that avatar in the assistant's chat: the
 * rows read *You unlocked your first agent avatar!* where the first chat opens,
 * and the checklist counts the task done once they have seen it. The event that
 * announces the Agent arrives afterwards and finds the task recorded, so it
 * holds no second one, and a reset deletes the rows, so the next create is
 * celebrated again.
 */
export async function recordProvisionedAgent(
  deps: { recorder: UnlockRecorder },
  owner: string,
  agent: { agentId: string; character: AvatarCharacter },
): Promise<void> {
  await deps.recorder.record(owner, "create-agent", agent);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A task the platform reports for the person — the
 * checklist item an assistant finished, such as the first result's schedule or
 * artifact — is recorded done and **seen**, and it is written on the caller's own
 * transaction: the assistant's first result holds one for its whole critical
 * section, and the checklist must not commit apart from it. The unlock is inserted
 * already seen, so no unseen hint and no celebration goes out for it. A row that is
 * already there — the domain event reached it first, as a schedule the person set
 * themselves does — is marked seen instead, or the task would never tick.
 * The caller announces the returned unlock after its transaction commits.
 */
export async function recordTaskSeenIn(
  deps: { repo: GettingStartedRepository; random: () => number },
  tx: DbTx,
  owner: string,
  task: GettingStartedTask,
): Promise<Unlock | null> {
  const unlock = await deps.repo.unlockIn(
    tx,
    owner,
    task,
    (taken) => chooseUnlock(taken, undefined, deps.random),
    { seen: true },
  );
  await deps.repo.markSeenIn(tx, owner, task);
  return unlock;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the checklist's own reset, on the caller's
 * transaction, so the assistant's onboarding reset clears the checklist and the
 * first result together or not at all. The caller announces the reset after its
 * transaction commits.
 */
export async function resetChecklistIn(
  deps: { repo: GettingStartedRepository },
  tx: DbTx,
  owner: string,
): Promise<void> {
  await deps.repo.resetIn(tx, owner);
}
