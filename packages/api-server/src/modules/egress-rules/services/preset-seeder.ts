import { randomUUID } from "node:crypto";
import type { EgressPreset } from "api-server-api";
import type { EgressRulesRepository } from "../infrastructure/egress-rules-repository.js";

export interface PresetSeeder {
  seed(agentId: string, preset: EgressPreset, decidedBy: string): Promise<void>;
  /** UNIT_BOUNDARY_DESCRIPTION: seeds the preset only for an Agent no preset ever wrote a rule for. Revoked preset rows count, so a create that re-runs after its record of this step was lost still leaves an owner's choice of no network access standing. */
  seedIfAbsent(
    agentId: string,
    preset: EgressPreset,
    decidedBy: string,
  ): Promise<void>;
}

export function createPresetSeeder(deps: {
  repo: EgressRulesRepository;
  trustedHosts: readonly string[];
}): PresetSeeder {
  const seed = async (
    agentId: string,
    preset: EgressPreset,
    decidedBy: string,
  ): Promise<void> => {
    await deps.repo.revokePresetRowsForAgent(agentId);
    if (preset === "none") return;
    if (preset === "all") {
      await deps.repo.insert({
        id: randomUUID(),
        agentId,
        host: "*",
        method: "*",
        pathPattern: "*",
        verdict: "allow",
        decidedBy,
        source: "preset:all",
      });
      return;
    }
    await deps.repo.insertAll(
      deps.trustedHosts.map((host) => ({
        id: randomUUID(),
        agentId,
        host,
        method: "*",
        pathPattern: "*",
        verdict: "allow",
        decidedBy,
        source: "preset:trusted",
      })),
    );
    await deps.repo.markPresetUnderConnections(
      agentId,
      deps.trustedHosts,
      "preset:trusted",
    );
  };

  return {
    seed,
    async seedIfAbsent(agentId, preset, decidedBy) {
      if (await deps.repo.hasPresetRowsForAgent(agentId)) return;
      await seed(agentId, preset, decidedBy);
    },
  };
}

export function markTrustedRowsTakenOver(deps: {
  repo: Pick<EgressRulesRepository, "markSeededConnectionRows">;
  trustedHosts: readonly string[];
}): Promise<number> {
  return deps.repo.markSeededConnectionRows(
    deps.trustedHosts,
    "preset:trusted",
  );
}
