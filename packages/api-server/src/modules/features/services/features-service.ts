import {
  featureIdSchema,
  type FeatureFlags,
  type FeaturesService,
} from "api-server-api";

import type { FeaturesRepository } from "../infrastructure/features-repository.js";

/** Every feature defaults OFF; only explicit toggles are stored, so unknown
 *  rows (a removed feature id) are ignored rather than surfaced. */
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
