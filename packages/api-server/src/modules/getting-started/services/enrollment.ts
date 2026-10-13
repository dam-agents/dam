import { everyUnlock } from "../domain/unlocks.js";
import type { GettingStartedRepository } from "../infrastructure/getting-started-repository.js";

export type OwnedAgentIds = (owner: string) => Promise<readonly string[]>;

export interface Enrollment {
  ensure(owner: string, newAgentId?: string): Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The first time the platform meets a user here, it
 * decides once whether the checklist applies to them. A user who already owns
 * an Agent used the product before the checklist existed, so they get every
 * avatar at once and no checklist. The Agent whose create triggered the visit
 * does not count, because creating it is the checklist's first task.
 */
export function createEnrollment(deps: {
  repo: GettingStartedRepository;
  ownedAgentIds: OwnedAgentIds;
}): Enrollment {
  return {
    async ensure(owner, newAgentId) {
      if (await deps.repo.find(owner)) return;
      const owned = await deps.ownedAgentIds(owner);
      const existingUser = owned.some((id) => id !== newAgentId);
      await deps.repo.enroll(owner, existingUser ? everyUnlock() : []);
    },
  };
}
