import { z } from "zod";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the three results the onboarding design counts as the
 * person having got something out of the platform, as the assistant reports them.
 */
export const firstResultKindSchema = z.enum([
  "schedule",
  "artifact",
  "knowledgeBase",
]);

/* UNIT_BOUNDARY_DESCRIPTION: the reference the assistant gives its result, which it wrote and a person may read: trimmed, whitespace-only is no reference at all, control characters are refused so it cannot carry escapes into a page, and it is capped at 500 characters. */
export const assistantFirstResultInputSchema = z.object({
  kind: firstResultKindSchema,
  ref: z
    .string()
    .max(2000)
    .refine(
      (value) => !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(value),
      {
        message: "a reference cannot carry control characters",
      },
    )
    .transform((value) => value.trim())
    .refine((value) => value.length <= 500, {
      message: "a reference is at most 500 characters",
    })
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
});
