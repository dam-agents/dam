import {
  featureIdSchema,
  type FeatureFlags,
  type FeaturesService,
} from "api-server-api";

import type { FeaturesRepository } from "../infrastructure/features-repository.js";

export function createFeaturesService(deps: {
  repo: FeaturesRepository;
  owner: string;
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
      return flags();
    },
  };
}
