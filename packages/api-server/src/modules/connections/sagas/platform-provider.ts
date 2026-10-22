import type { FeatureId } from "api-server-api";
import { filter, mergeMap, type Subscription } from "rxjs";

import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import {
  events$,
  EventType,
  type FeatureFlagChanged,
  ofType,
} from "../../../events.js";
import type { ManagedProviderConnections } from "../services/connections-service.js";

const PLATFORM_PROVIDER: FeatureId = "platform-provider";

async function reconcile(
  managedFor: (owner: string) => ManagedProviderConnections,
  owner: string,
): Promise<void> {
  try {
    await managedFor(owner).reconcileManagedConnections();
  } catch (err) {
    getLogger().error(
      { owner, reason: formatError(err) },
      "connections.platform_provider_reconcile_failed",
    );
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: turning the built-in provider feature on gives
 * the user its Connection, and turning it off removes that Connection and so
 * revokes it from every agent holding it. Flag changes run concurrently: the
 * reconcile reads the flag under a per-owner lock, so a quick on-off-on still
 * settles on the last state, and one slow owner holds up no other.
 */
export function startPlatformProviderSaga(
  managedFor: (owner: string) => ManagedProviderConnections,
): Subscription {
  return events$()
    .pipe(
      ofType<FeatureFlagChanged>(EventType.FeatureFlagChanged),
      filter((ev) => ev.feature === PLATFORM_PROVIDER),
      mergeMap((ev) => reconcile(managedFor, ev.actorSub)),
    )
    .subscribe();
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a listing only reconciles the user who lists, so
 * after the operator removes a model server or changes it, Connections of
 * users who do not come back would keep pointing agents at the old endpoint.
 * At boot every user holding a deployment-owned provider is reconciled once,
 * which removes it everywhere when the install no longer configures it and
 * otherwise brings it to the current key and name.
 */
export async function sweepManagedConnections(
  owners: () => Promise<string[]>,
  managedFor: (owner: string) => ManagedProviderConnections,
): Promise<void> {
  for (const owner of await owners()) await reconcile(managedFor, owner);
}
