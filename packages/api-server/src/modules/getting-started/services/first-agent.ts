import type { AvatarCharacter } from "api-server-api/avatar/svg";

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
