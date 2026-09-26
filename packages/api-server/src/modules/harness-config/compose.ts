import type { Db } from "db";
import type { HarnessConfigService } from "api-server-api";
import { createHarnessConfigService } from "./services/harness-config-service.js";
import { createHarnessConfigSnapshotRepo } from "./infrastructure/snapshot-repo.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";

export function composeHarnessConfigModule(deps: {
  db: Db;
  surface: string;
  runtimeMutator: RuntimeMutator;
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
    }),
  };
}
