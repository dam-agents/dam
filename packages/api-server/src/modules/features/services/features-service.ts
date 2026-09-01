import {
  featureIdSchema,
  type FeatureFlags,
  type FeaturesService,
} from "api-server-api";

import type { FeaturesRepository } from "../infrastructure/features-repository.js";
import { emit, EventType } from "../../../events.js";

export function createFeaturesService(deps: {
  repo: FeaturesRepository;
  owner: string;
  surface: string;
}): FeaturesService {
  async function flags(): Promise<FeatureFlags> {
    const stored = await deps.repo.listEnabled(deps.owner);
    return Object.fromEntries(
      featureIdSchema.options.map((id) => [id, stored[id] ?? false]),
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
