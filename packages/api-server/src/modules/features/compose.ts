import type { Db } from "db";
import type { FeaturesService } from "api-server-api";

import { createFeaturesRepository } from "./infrastructure/features-repository.js";
import { createFeaturesService } from "./services/features-service.js";

export function composeFeaturesForOwner(opts: { db: Db; owner: string }): {
  features: FeaturesService;
} {
  return {
    features: createFeaturesService({
      repo: createFeaturesRepository(opts.db),
      owner: opts.owner,
    }),
  };
}
