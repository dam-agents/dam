import {
  featureIdSchema,
  type FeatureFlags,
  type FeatureModes,
  type FeaturesService,
} from "api-server-api";

import type { FeaturesRepository } from "../infrastructure/features-repository.js";
import { emit, EventType } from "../../../events.js";

export function createFeaturesService(deps: {
  repo: FeaturesRepository;
  owner: string;
  surface: string;
  modes: FeatureModes;
}): FeaturesService {
  async function flags(): Promise<FeatureFlags> {
    const stored = await deps.repo.listEnabled(deps.owner);
    return Object.fromEntries(
      featureIdSchema.options.map((id) => {
        const mode = deps.modes[id] ?? "experimental";
        return [
          id,
          mode === "experimental" ? (stored[id] ?? false) : mode === "on",
        ];
      }),
    ) as FeatureFlags;
  }

  return {
    flags,
    async setFlag(feature, enabled) {
      await deps.repo.upsert(deps.owner, feature, enabled);
      emit({
        type: EventType.FeatureFlagChanged,
        actorSub: deps.owner,
        surface: deps.surface,
        feature,
        enabled,
      });
      return flags();
    },
  };
}
