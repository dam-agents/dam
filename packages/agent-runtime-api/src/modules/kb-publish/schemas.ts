import { z } from "zod";

import { kbPublishCapsSchema } from "../kb-snapshot/caps.js";

export const kbPublishSyncInputSchema = z.object({
  roots: z.array(z.string().min(1)).max(16).nullable(),
  caps: kbPublishCapsSchema,
  flush: z.boolean(),
});

export type KbPublishSyncInput = z.infer<typeof kbPublishSyncInputSchema>;
