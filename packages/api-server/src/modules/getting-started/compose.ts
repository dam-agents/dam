import type { GettingStartedService } from "api-server-api";
import type { Subscription } from "rxjs";
import type { Db } from "db";

import { createGettingStartedRepository } from "./infrastructure/getting-started-repository.js";
import { startUnlockAvatarsSaga } from "./sagas/unlock-avatars.js";
import { createEnrollment, type OwnedAgentIds } from "./services/enrollment.js";
import { createGettingStartedService } from "./services/getting-started-service.js";
import { createUnlockRecorder } from "./services/unlock-recorder.js";

export interface GettingStartedModule {
  forOwner(owner: string): GettingStartedService;
  /* UNIT_BOUNDARY_DESCRIPTION: decides once whether the checklist applies to this person, without reading their progress. Provisioning an Agent for them calls it first, so the Agent it is about to create is not mistaken for one they had before. */
  ensureEnrolled(owner: string): Promise<void>;
  start(): void;
  stop(): void;
}

export function composeGettingStartedModule(deps: {
  db: Db;
  ownedAgentIds: OwnedAgentIds;
}): GettingStartedModule {
  const repo = createGettingStartedRepository(deps.db);
  const enrollment = createEnrollment({
    repo,
    ownedAgentIds: deps.ownedAgentIds,
  });
  const recorder = createUnlockRecorder({
    repo,
    enrollment,
    random: Math.random,
  });
  let sub: Subscription | null = null;
  return {
    forOwner: (owner) =>
      createGettingStartedService({ repo, enrollment, owner }),
    ensureEnrolled: (owner) => enrollment.ensure(owner),
    start() {
      sub ??= startUnlockAvatarsSaga(recorder);
    },
    stop() {
      sub?.unsubscribe();
      sub = null;
    },
  };
}
