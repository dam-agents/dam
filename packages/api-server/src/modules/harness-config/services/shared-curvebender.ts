import { routesByModelName } from "agent-runtime-api";
import { aliasForProviderType } from "api-server-api";
import type { HarnessCatalog, OwnerModelCatalogView } from "api-server-api";
import { formatError } from "../../../core/format-error.js";
import {
  automaticModel,
  type GrantedProvider,
} from "../domain/session-pair.js";
import { defaultHarnessOf } from "./harness-config-service.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a run always has a model, so an Agent that holds
 * nothing serving its harness gets the deployment's shared CurveBender before
 * anyone asks it to run: at every hello, and only then, since the grant is a
 * write and a running run cannot wait for it to reach the Agent. Nothing is
 * usable when no provider the Agent holds lists a model for its harness, as
 * the automatic model reads the same catalog; an Agent holding a CurveBender
 * already keeps it, since both spell the one `cb` alias. The grant repeats
 * safely and no default is saved, so the run picks the CurveBender up as it
 * picks up any provider. Every failure is logged and swallowed: a hello is no
 * place to fail.
 */
export function createSharedCurveBenderGrant(deps: {
  enabled: boolean;
  catalog: HarnessCatalog;
  getCapabilities: (agentId: string) => Promise<unknown>;
  specHarness: (agentId: string) => Promise<string | undefined>;
  ownerCatalog: (
    agentId: string,
  ) => Promise<Pick<OwnerModelCatalogView, "providers">>;
  grantedProviders: (agentId: string) => Promise<GrantedProvider[]>;
  grant: (agentId: string) => Promise<boolean>;
  publishDefaults: (agentId: string) => Promise<void>;
  log: (msg: string) => void;
}): (agentId: string) => Promise<void> {
  return async (agentId) => {
    if (!deps.enabled) return;
    try {
      const [capabilities, catalog, granted] = await Promise.all([
        deps.getCapabilities(agentId),
        deps.ownerCatalog(agentId),
        deps.grantedProviders(agentId),
      ]);
      if (!routesByModelName(capabilities)) return;
      if (granted.some((p) => aliasForProviderType(p.type) === "cb")) return;
      const harness =
        defaultHarnessOf(capabilities) ??
        (await deps.specHarness(agentId)) ??
        deps.catalog.default;
      if (automaticModel(catalog.providers, { harness, provider: null }))
        return;
      if (!(await deps.grant(agentId))) return;
      deps.log(`[shared-curvebender] ${agentId}: granted`);
      await deps.publishDefaults(agentId);
    } catch (err) {
      deps.log(`[shared-curvebender] ${agentId}: ${formatError(err)}`);
    }
  };
}
