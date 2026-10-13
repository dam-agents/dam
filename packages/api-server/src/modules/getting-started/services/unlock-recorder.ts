import type { GettingStartedTask } from "api-server-api";
import type { AvatarCharacter } from "api-server-api/avatar/svg";

import { emit, EventType } from "../../../events.js";
import { chooseUnlock } from "../domain/unlocks.js";
import type { GettingStartedRepository } from "../infrastructure/getting-started-repository.js";
import type { Enrollment } from "./enrollment.js";

export interface UnlockRecorder {
  record(
    owner: string,
    task: GettingStartedTask,
    created?: { agentId: string; character: AvatarCharacter },
  ): Promise<void>;
}

export function createUnlockRecorder(deps: {
  repo: GettingStartedRepository;
  enrollment: Enrollment;
  random: () => number;
}): UnlockRecorder {
  return {
    async record(owner, task, created) {
      await deps.enrollment.ensure(owner, created?.agentId);
      const unlock = await deps.repo.unlock(owner, task, (taken) =>
        chooseUnlock(taken, created?.character, deps.random),
      );
      if (!unlock) return;
      emit({
        type: EventType.AvatarUnlocked,
        ownerSub: owner,
        task: unlock.task,
        character: unlock.character,
      });
    },
  };
}
