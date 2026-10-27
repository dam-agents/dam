import type { Db } from "db";
import type { HarnessCatalog, OwnerModelCatalogView } from "api-server-api";
import type { SubPseudonymizer } from "../../core/sub-pseudonymizer.js";
import { createProfilesRepository } from "./infrastructure/profiles-repository.js";
import {
  bindDefaultProfile,
  createProfilesService,
  newAgentDefault,
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
  seed: { harness: string; model: string } | null;
  ownerCatalog: () => Promise<OwnerModelCatalogView>;
  republish: (agentId: string) => Promise<string | null>;
}) {
  const repo = createProfilesRepository(deps.db, deps.subPseudonymizer);
  const owner = {
    repo,
    owner: deps.owner,
    catalog: deps.catalog,
    seed: deps.seed,
    ownerCatalog: deps.ownerCatalog,
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
    defaultProfile: async () => {
      const chosen = await newAgentDefault(owner);
      return (
        chosen && {
          harness: chosen.profile.harness,
          connectionId: chosen.connectionId,
          bind: (agentId: string) =>
            bindDefaultProfile(owner, agentId, chosen.profile),
        }
      );
    },
  };
}
