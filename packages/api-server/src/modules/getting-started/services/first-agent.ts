import type { AvatarCharacter } from "api-server-api/avatar/svg";

import type { GettingStartedRepository } from "../infrastructure/getting-started-repository.js";
import type { UnlockRecorder } from "./unlock-recorder.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: An Agent the platform made for a person is not one
 * they made, so the first task it finishes is recorded already seen: the
 * checklist counts "Create your first agent" as done instead of holding a
 * celebration for something nobody did. The event that announces the Agent
 * arrives afterwards and finds the task recorded, so it holds no second one.
 */
export async function recordProvisionedAgent(
  deps: { recorder: UnlockRecorder; repo: GettingStartedRepository },
  owner: string,
  agent: { agentId: string; character: AvatarCharacter },
): Promise<void> {
  await deps.recorder.record(owner, "create-agent", agent);
  await deps.repo.markSeen(owner, "create-agent");
}
