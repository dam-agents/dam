import { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type UserAuthenticated,
} from "../../../events.js";

export type PersistActorRolesDeps = {
  upsertActorRole: (actorSub: string, isCore: boolean) => Promise<void>;
};

const STREAM_CONCURRENCY = 8;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Records the core-role flag an actor carried at auth
 * time. Split out of the persist-activity saga because that one runs only when
 * activity tracking is enabled, while this flag also gates the Case Study
 * inspector read paths: folded together, an install with activity writes off
 * would read every actor as non-core and no inspector could reach a released
 * Edition.
 */
export function startPersistActorRolesSaga(
  deps: PersistActorRolesDeps,
): Subscription {
  const sub = new Subscription();

  sub.add(
    events$()
      .pipe(
        ofType<UserAuthenticated>(EventType.UserAuthenticated),
        mergeMap(async (event) => {
          try {
            await deps.upsertActorRole(event.userSub, event.isCore);
          } catch (err) {
            process.stderr.write(
              `[usage/persist-actor-roles] upsert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  return sub;
}
