import { z } from "zod";

/** The closed set of toggleable features. Adding one: extend this enum and
 *  give it a row in the UI's Features menu — storage needs no migration
 *  (absent row = off). */
export const featureIdSchema = z.enum([
  "advanced-connections",
  "experiments",
  "artifacts",
]);

export const featureSetFlagInputSchema = z.object({
  feature: featureIdSchema,
  enabled: z.boolean(),
});
