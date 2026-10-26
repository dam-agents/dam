import type { Db } from "db";
import type { HarnessCatalog } from "api-server-api";
import type { SubPseudonymizer } from "../../core/sub-pseudonymizer.js";
import { createProfilesRepository } from "./infrastructure/profiles-repository.js";
import {
  bindDefaultProfile,
  createProfilesService,
  profileResolver,
} from "./services/profiles-service.js";

export function composeProfileResolver(db: Db, pseudo: SubPseudonymizer) {
  return profileResolver(createProfilesRepository(db, pseudo));
}

export function composeProfilesForOwner(deps: {
  db: Db;
  subPseudonymizer: SubPseudonymizer;
  owner: string;
  agentBinding: readonly string[] | "*";
  catalog: Pick<HarnessCatalog, "default" | "harnesses">;
  sharedProvider: boolean;
  republish: (agentId: string) => Promise<string | null>;
}) {
  const repo = createProfilesRepository(deps.db, deps.subPseudonymizer);
  const owner = {
    repo,
    owner: deps.owner,
    catalog: deps.catalog,
    sharedProvider: deps.sharedProvider,
  };
  const resolveProfile = profileResolver(repo);
  return {
    profiles: createProfilesService({
      ...owner,
      agentBinding: deps.agentBinding,
      resolve: resolveProfile,
      republish: deps.republish,
    }),
    resolveProfile,
    bindDefaultProfile: (agentId: string, harness: string) =>
      bindDefaultProfile(owner, agentId, harness),
  };
}
