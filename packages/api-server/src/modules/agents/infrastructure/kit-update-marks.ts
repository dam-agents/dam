import type { KitUpdatePending, SeedStamp } from "api-server-api";
import type { AgentsRepository } from "./agents-repository.js";
import {
  ANN_KIT_UPDATE_PENDING,
  ANN_KIT_UPDATE_SKIPPED,
  ANN_STARTER_KIT_SEED,
} from "./labels.js";

export function createKitUpdateMarks(
  repo: Pick<AgentsRepository, "patchAnnotations">,
) {
  return {
    begin: (agentId: string, stamp: SeedStamp, pending: KitUpdatePending) =>
      repo.patchAnnotations(agentId, {
        [ANN_STARTER_KIT_SEED]: JSON.stringify(stamp),
        [ANN_KIT_UPDATE_PENDING]: JSON.stringify(pending),
      }),
    skip: (agentId: string, commit: string) =>
      repo.patchAnnotations(agentId, { [ANN_KIT_UPDATE_SKIPPED]: commit }),
    end: (agentId: string, stamp: SeedStamp | null) =>
      repo.patchAnnotations(agentId, {
        ...(stamp ? { [ANN_STARTER_KIT_SEED]: JSON.stringify(stamp) } : {}),
        [ANN_KIT_UPDATE_PENDING]: null,
      }),
  };
}
