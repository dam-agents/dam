import type { z } from "zod";
import type { featureIdSchema } from "./schemas.js";

export type FeatureId = z.infer<typeof featureIdSchema>;

export type FeatureFlags = Record<FeatureId, boolean>;

export interface FeaturesService {
  flags(): Promise<FeatureFlags>;
  setFlag(feature: FeatureId, enabled: boolean): Promise<FeatureFlags>;
}
