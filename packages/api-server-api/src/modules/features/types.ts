import type { z } from "zod";
import type {
  featureEntrySchema,
  featureIdSchema,
  featureLevelSchema,
  featureModeSchema,
} from "./schemas.js";

export type FeatureId = z.infer<typeof featureIdSchema>;

export type FeatureFlags = Record<FeatureId, boolean>;

export type FeatureLevel = z.infer<typeof featureLevelSchema>;

export type FeatureMode = z.infer<typeof featureModeSchema>;

export type FeatureEntry = z.infer<typeof featureEntrySchema>;

export type FeatureModes = Partial<Record<FeatureId, FeatureMode>>;

export interface FeaturesService {
  flags(): Promise<FeatureFlags>;
  setFlag(feature: FeatureId, enabled: boolean): Promise<FeatureFlags>;
}
