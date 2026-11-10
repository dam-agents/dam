import type { GettingStartedTask } from "api-server-api";
import type { AvatarCharacter } from "api-server-api/avatar/svg";

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
 * artifact — is recorded done and **seen**: the platform did it on their behalf, so
 * the checklist counts it rather than celebrating it. A task the checklist has no
 * item for is not reported here at all.
 * A row that is already unlocked — the domain event reached it first, as a schedule
 * the person set themselves does — is left unseen by the recorder, so the mark is
 * written here too, or the task would never tick.
 */
export async function recordTaskSeen(
  deps: { recorder: UnlockRecorder; repo: GettingStartedRepository },
  owner: string,
  task: GettingStartedTask,
): Promise<void> {
  await deps.recorder.record(owner, task);
  await deps.repo.markSeen(owner, task);
}
