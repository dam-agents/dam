import { randomUUID } from "node:crypto";
import type { EgressPreset } from "api-server-api";
import type { EgressRulesRepository } from "../infrastructure/egress-rules-repository.js";

export interface PresetSeeder {
  seed(agentId: string, preset: EgressPreset, decidedBy: string): Promise<void>;
}

export interface CreatePresetSeederDeps {
  repo: EgressRulesRepository;
  trustedHosts: readonly string[];
}

export function createPresetSeeder(deps: CreatePresetSeederDeps): PresetSeeder {
  return {
    async seed(agentId, preset, decidedBy) {
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
      for (const host of deps.trustedHosts) {
        await deps.repo.insert({
          id: randomUUID(),
          agentId,
          host,
          method: "*",
          pathPattern: "*",
          verdict: "allow",
          decidedBy,
          source: "preset:trusted",
        });
      }
    },
  };
}
