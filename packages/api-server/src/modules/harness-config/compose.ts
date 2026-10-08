import type { Db } from "db";
import type {
  HarnessCatalog,
  HarnessConfigService,
  SessionPair,
} from "api-server-api";
import {
  createHarnessConfigService,
  resolveFirePair,
  sessionModelChoices,
} from "./services/harness-config-service.js";
import { createSessionPairRepo } from "./infrastructure/session-pair-repo.js";
import { createHarnessConfigSnapshotRepo } from "./infrastructure/snapshot-repo.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";

export function composeHarnessConfigModule(deps: {
  db: Db;
  surface: string;
  runtimeMutator: RuntimeMutator;
  catalog: HarnessCatalog;
  ownerSub: string;
  isOwnedAgent: (agentId: string) => Promise<boolean>;
  getCapabilities: (agentId: string) => Promise<unknown>;
  isSettled: (agentId: string) => Promise<boolean>;
}): { service: HarnessConfigService } {
  const { db, ...serviceDeps } = deps;
  return {
    service: createHarnessConfigService({
      ...serviceDeps,
      snapshotRepo: createHarnessConfigSnapshotRepo(db),
      pairRepo: createSessionPairRepo(db),
    }),
  };
}

export function composeSessionModelChoices(deps: {
  db: Db;
  getCapabilities: (agentId: string) => Promise<unknown>;
}): (agentId: string) => Promise<string[] | null> {
  const snapshotRepo = createHarnessConfigSnapshotRepo(deps.db);
  return async (agentId) =>
    sessionModelChoices(
      await deps.getCapabilities(agentId),
      (await snapshotRepo.read(agentId))?.availableModels ?? null,
    );
}

export type FirePair = (
  agentId: string,
  preferred: { harness?: string; provider?: string; model?: string },
) => Promise<SessionPair | null | undefined>;

export function composeFirePair(deps: {
  db: Db;
  catalog: HarnessCatalog;
  getCapabilities: (agentId: string) => Promise<unknown>;
}): FirePair {
  const resolver = { ...deps, pairRepo: createSessionPairRepo(deps.db) };
  return (agentId, preferred) => resolveFirePair(resolver, agentId, preferred);
}
