import type { Db } from "db";
import {
  aliasForTemplateId,
  CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  CURVE_BENDER_WORK_MODEL,
  type HarnessCatalog,
} from "api-server-api";
import { createProfilesRepository } from "./infrastructure/profiles-repository.js";
import {
  createProfilesService,
  type BindDefaultAgentProfile,
  type SeededProvider,
} from "./services/profiles-service.js";
import { createProfileResolver } from "./services/profile-resolution.js";

/** UNIT_BOUNDARY_DESCRIPTION: what the seeded profile names when the deployment serves the shared CurveBender, built from the same constants the Connection and the model router use so the two cannot drift. */
export function seededProvider(shared: boolean): SeededProvider | null {
  if (!shared) return null;
  const alias = aliasForTemplateId(CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID);
  if (alias === null) return null;
  return {
    providerTemplate: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
    model: `${alias}/${CURVE_BENDER_WORK_MODEL}`,
  };
}

export function composeProfilesForOwner(deps: {
  db: Db;
  owner: string;
  catalog: Pick<HarnessCatalog, "default" | "harnesses">;
  sharedProvider: boolean;
}): {
  profiles: ReturnType<typeof createProfilesService>;
  resolver: ReturnType<typeof createProfileResolver>;
  bindDefaultAgentProfile: BindDefaultAgentProfile;
} {
  const repo = createProfilesRepository(deps.db);
  const profiles = createProfilesService({
    repo,
    owner: deps.owner,
    catalog: deps.catalog,
    seededProvider: seededProvider(deps.sharedProvider),
  });
  return {
    profiles,
    resolver: createProfileResolver({ repo }),
    bindDefaultAgentProfile: profiles.bindDefaultAgentProfile,
  };
}
