import type { Db } from "db";
import type {
  HarnessConfigService,
  HarnessConfigSnapshotPatch,
} from "api-server-api";
import { createHarnessConfigService } from "./services/harness-config-service.js";
import { createHarnessConfigSnapshotRepo } from "./infrastructure/snapshot-repo.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";
import { emit, EventType } from "../../events.js";

export function composeHarnessConfigModule(deps: {
  db: Db;
  runtimeMutator: RuntimeMutator;
  ownerSub: string;
  isOwnedAgent: (agentId: string) => Promise<boolean>;
  getCapabilities: (agentId: string) => Promise<unknown>;
  isSettled: (agentId: string) => Promise<boolean>;
}): { service: HarnessConfigService } {
  return {
    service: createHarnessConfigService({
      runtimeMutator: deps.runtimeMutator,
      snapshotRepo: createHarnessConfigSnapshotRepo(deps.db),
      ownerSub: deps.ownerSub,
      isOwnedAgent: deps.isOwnedAgent,
      getCapabilities: deps.getCapabilities,
      isSettled: deps.isSettled,
    }),
  };
}

export function createHarnessConfigSnapshotWriter(deps: {
  db: Db;
  resolveOwner: (agentId: string) => Promise<string | null>;
}): {
  merge(
    agentId: string,
    patch: HarnessConfigSnapshotPatch,
    opts: { confirmed: boolean },
  ): Promise<void>;
} {
  const repo = createHarnessConfigSnapshotRepo(deps.db);
  return {
    async merge(agentId, patch, opts) {
      await repo.merge(agentId, patch, opts);
      if (!opts.confirmed) return;
      const ownerSub = await deps.resolveOwner(agentId);
      if (!ownerSub) return;
      emit({ type: EventType.HarnessConfigChanged, agentId, ownerSub });
    },
  };
}
