import type { Db, DbTx } from "db";
import type { HarnessCatalog, SessionPair } from "api-server-api";
import type { SubPseudonymizer } from "../../core/sub-pseudonymizer.js";
import { createProfilesRepository } from "./infrastructure/profiles-repository.js";
import {
  bindNewAgentDefault,
  createProfilesService,
  newAgentDefault,
  profileResolver,
} from "./services/profiles-service.js";

export function composeProfileResolver(db: Db, pseudo: SubPseudonymizer) {
  return profileResolver(createProfilesRepository(db, pseudo));
}

/* UNIT_BOUNDARY_DESCRIPTION: the same resolver over one transaction's connection, for a read that holds the agent's row and must not take a second connection (D193B). */
export function composeProfileResolverOn(pseudo: SubPseudonymizer) {
  return (executor: Db | DbTx) =>
    profileResolver(createProfilesRepository(executor as Db, pseudo));
}

export function composeProfilesForOwner(deps: {
  db: Db;
  subPseudonymizer: SubPseudonymizer;
  owner: string;
  agentBinding: readonly string[] | "*";
  catalog: Pick<HarnessCatalog, "default" | "harnesses">;
  sharedCurveBender: boolean;
  reconcileConnections?: () => Promise<void>;
  republish: (agentId: string) => Promise<string | null>;
  settingsProblem: (pair: SessionPair) => Promise<string | null>;
}) {
  const repo = createProfilesRepository(deps.db, deps.subPseudonymizer);
  const owner = {
    repo,
    owner: deps.owner,
    catalog: deps.catalog,
    sharedCurveBender: deps.sharedCurveBender,
  };
  const resolveProfile = profileResolver(repo);
  return {
    profiles: createProfilesService({
      ...owner,
      agentBinding: deps.agentBinding,
      resolve: resolveProfile,
      republish: deps.republish,
      settingsProblem: deps.settingsProblem,
    }),
    resolveProfile,
    newAgentDefault: async () => {
      const chosen = await newAgentDefault({
        ...owner,
        reconcileConnections: deps.reconcileConnections,
      });
      return (
        chosen && {
          name: chosen.profile?.name ?? null,
          model: chosen.pair.model,
          harness: chosen.pair.harness,
          connectionId: chosen.connectionId,
          bind: (agentId: string) =>
            bindNewAgentDefault(owner, agentId, chosen),
        }
      );
    },
  };
}
