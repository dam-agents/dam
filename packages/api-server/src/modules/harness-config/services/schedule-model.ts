import { parseQualifiedModel } from "api-server-api";
import { routesByModelName } from "agent-runtime-api";
import type { HarnessConfigSnapshotRepo } from "../infrastructure/snapshot-repo.js";
import { sessionModelSupported } from "./harness-config-service.js";

const plain = (name: string): string => {
  const unbracketed = name.trim().replace(/\[1m\]$/i, "");
  const parsed = parseQualifiedModel(unbracketed, { claudePrefix: true });
  return (parsed?.upstreamId ?? unbracketed.replace(/^claude\//i, ""))
    .replace(/\[1m\]$/i, "")
    .toLowerCase();
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: Old runtime path: remove when
 * agents.runtimeFleet.outdated is empty on prod. A runtime that takes no
 * model per session runs every session on the model its harness is set to,
 * and the upgrade copied that same model onto its schedules, so a fire drops
 * a schedule model that names it and the run goes ahead as it always did. A
 * schedule model that names another model is kept, for the session check to
 * refuse.
 */
export function createScheduleModelForFire(deps: {
  getCapabilities: (agentId: string) => Promise<unknown>;
  snapshotRepo: HarnessConfigSnapshotRepo;
}): (agentId: string, model: string) => Promise<string | undefined> {
  return async (agentId, model) => {
    const capabilities = await deps.getCapabilities(agentId);
    if (routesByModelName(capabilities) || sessionModelSupported(capabilities))
      return model;
    const own = (await deps.snapshotRepo.read(agentId))?.model ?? null;
    return own && plain(own) === plain(model) ? undefined : model;
  };
}
