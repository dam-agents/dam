import type { GettingStartedService } from "api-server-api";

import { toProgress } from "../domain/unlocks.js";
import type { GettingStartedRepository } from "../infrastructure/getting-started-repository.js";
import type { Enrollment } from "./enrollment.js";

export function createGettingStartedService(deps: {
  repo: GettingStartedRepository;
  enrollment: Enrollment;
  owner: string;
}): GettingStartedService {
  async function progress() {
    await deps.enrollment.ensure(deps.owner);
    const checklist = await deps.repo.find(deps.owner);
    return toProgress(checklist ?? { dismissedAt: null, unlocks: [] });
  }

  return {
    progress,
    async markUnlockSeen(task) {
      await deps.repo.markSeen(deps.owner, task);
      return progress();
    },
    async markAvatarPicked(character) {
      await deps.repo.markPicked(deps.owner, character);
      return progress();
    },
    async setDismissed(dismissed) {
      await deps.enrollment.ensure(deps.owner);
      await deps.repo.setDismissed(deps.owner, dismissed);
      return progress();
    },
  };
}
