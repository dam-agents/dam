import { z } from "zod";

import { stripWhitespace } from "../provider-form-shell.js";
import { MODE_KEYS, MODES } from "./modes.js";

export const anthropicCredentialSchema = z
  .object({
    mode: z.enum(MODE_KEYS),
    value: z.string(),
  })
  .superRefine((data, ctx) => {
    const v = stripWhitespace(data.value);
    if (v.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Required",
      });
      return;
    }
    for (const m of MODE_KEYS) {
      if (m !== data.mode && v.startsWith(MODES[m].prefix)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: `This looks like ${MODES[m].label.toLowerCase()} — switch tabs.`,
        });
      }
    }
  });

export type AnthropicCredentialValues = z.infer<
  typeof anthropicCredentialSchema
>;
