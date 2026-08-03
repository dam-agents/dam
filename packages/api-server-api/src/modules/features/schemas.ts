import { z } from "zod";

/** The closed set of toggleable features. Adding one: extend this enum and
 *  give it a row in the UI's Features menu — storage needs no migration
 *  (absent row = off). Removing one graduates it to always-on: stored rows for
 *  a dropped id are simply never read again (experiments and knowledge-bases
 *  graduated this way). */
export const featureIdSchema = z.enum([
  "advanced-connections",
  "vm-sandboxes",
  "session-costs",
]);

export const featureSetFlagInputSchema = z.object({
  feature: featureIdSchema,
  enabled: z.boolean(),
});
