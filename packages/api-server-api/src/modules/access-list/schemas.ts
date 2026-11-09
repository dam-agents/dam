import { z } from "zod";
import { viewerEmailSchema } from "../artifact-library/schemas.js";

export const ACCESS_LIST_ADD_MAX = 200;

export const accessListAddInputSchema = z.object({
  emails: z
    .array(viewerEmailSchema)
    .min(1, "name at least one email address")
    .max(ACCESS_LIST_ADD_MAX, `at most ${ACCESS_LIST_ADD_MAX} addresses at once`)
    .transform((emails) => [...new Set(emails)]),
});

export const accessListRemoveInputSchema = z.object({
  email: viewerEmailSchema,
});

export const accessListEntrySchema = z.object({
  email: z.string(),
  addedAt: z.string(),
});

export const accessListSchema = z.object({
  enabled: z.boolean(),
  entries: z.array(accessListEntrySchema),
});
