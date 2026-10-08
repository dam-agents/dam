import { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type IdentityLinked,
} from "../../../events.js";
import type { ExternalActorLink } from "../infrastructure/external-actor-links-repository.js";

export type PersistExternalActorLinksDeps = {
  upsert: (links: ReadonlyArray<ExternalActorLink>) => Promise<void>;
};

const STREAM_CONCURRENCY = 4;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Keeps the pseudonymized map from a Slack or
 * Telegram user to the platform user they linked to. A channel turn records
 * only the messenger id of its sender, so this map is what lets an active day
 * count a message sent from Slack. The identity link itself is deleted when the
 * user logs out of Slack; the map row is kept, so turns sent before the logout
 * stay attributed.
 */
export function startPersistExternalActorLinksSaga(
  deps: PersistExternalActorLinksDeps,
): Subscription {
  return events$()
    .pipe(
      ofType<IdentityLinked>(EventType.IdentityLinked),
      mergeMap(async (event) => {
        try {
          await deps.upsert([
            {
              provider: event.provider,
              externalUserId: event.externalUserId,
              keycloakSub: event.keycloakSub,
            },
          ]);
        } catch (err) {
          process.stderr.write(
            `[usage/persist-external-actor-links] upsert failed: ${err}\n`,
          );
        }
      }, STREAM_CONCURRENCY),
    )
    .subscribe();
}
