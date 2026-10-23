import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import type { ManagedProviderConnections } from "../services/connections-service.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a listing only reconciles the user who lists, so
 * after the operator rotates the deployment's CurveBender key or removes it,
 * Connections of users who do not come back would keep the old copy forever.
 * At boot every user holding a deployment-owned provider is reconciled once,
 * which removes it everywhere when the install no longer configures it and
 * otherwise brings it to the current key and name.
 */
export async function sweepManagedConnections(
  owners: () => Promise<string[]>,
  managedFor: (owner: string) => ManagedProviderConnections,
): Promise<void> {
  for (const owner of await owners()) {
    try {
      await managedFor(owner).reconcileManagedConnections();
    } catch (err) {
      getLogger().error(
        { owner, reason: formatError(err) },
        "connections.managed_provider_reconcile_failed",
      );
    }
  }
}
