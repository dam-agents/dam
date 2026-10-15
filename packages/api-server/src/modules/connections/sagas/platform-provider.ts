import type { FeatureId } from "api-server-api";
import { concatMap, filter, type Subscription } from "rxjs";

import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import {
  events$,
  EventType,
  type FeatureFlagChanged,
  ofType,
} from "../../../events.js";
import type { PlatformLlmConnections } from "../services/connections-service.js";

const PLATFORM_PROVIDER: FeatureId = "platform-provider";

/**
 * UNIT_BOUNDARY_DESCRIPTION: turning the built-in provider feature on gives
 * the user its Connection, and turning it off removes that Connection and so
 * revokes it from every agent holding it. Flag changes are handled one at a
 * time, so a quick on-off-on settles on the last state.
 */
export function startPlatformProviderSaga(
  platformFor: (owner: string) => PlatformLlmConnections,
): Subscription {
  return events$()
    .pipe(
      ofType<FeatureFlagChanged>(EventType.FeatureFlagChanged),
      filter((ev) => ev.feature === PLATFORM_PROVIDER),
      concatMap(async (ev) => {
        try {
          await platformFor(ev.actorSub).reconcilePlatformConnection();
        } catch (err) {
          getLogger().error(
            { owner: ev.actorSub, reason: formatError(err) },
            "connections.platform_provider_reconcile_failed",
          );
        }
      }),
    )
    .subscribe();
}
