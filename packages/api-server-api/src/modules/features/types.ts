import type { z } from "zod";
import type { featureIdSchema } from "./schemas.js";

/** A toggleable pre-release surface. Every feature defaults OFF and is
 *  enabled per user via the hidden Features menu (five taps on the version
 *  string in Settings). Server-stored because feature surfaces include the
 *  per-agent MCP tools — hiding them is not a UI-only concern. */
export type FeatureId = z.infer<typeof featureIdSchema>;

export type FeatureFlags = Record<FeatureId, boolean>;

/** Owner-scoped per-user feature flags. */
export interface FeaturesService {
  flags(): Promise<FeatureFlags>;
  setFlag(feature: FeatureId, enabled: boolean): Promise<FeatureFlags>;
}
