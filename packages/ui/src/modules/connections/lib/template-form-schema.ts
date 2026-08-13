import type { ConnectionTemplateView } from "api-server-api";
import { z } from "zod";

import {
  slugifyTemplateName,
  validateConnectionName,
} from "./connection-name.js";

export function buildTemplateFormSchema(template: ConnectionTemplateView) {
  const patterns = new Map<string, RegExp>();
  for (const input of template.inputs) {
    if (!input.pattern) continue;
    try {
      patterns.set(input.name, new RegExp(input.pattern));
    } catch {}
  }
  return z
    .object({
      name: z.string(),
      overrideDefaults: z.boolean(),
      fields: z.record(z.string(), z.string()),
    })
    .superRefine((v, ctx) => {
      const nameError = validateConnectionName(v.name.trim());
      if (nameError)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["name"],
          message: nameError,
        });
      for (const input of template.inputs) {
        if (input.state === "overridable" && !v.overrideDefaults) continue;
        const raw = (v.fields[input.name] ?? "").trim();
        const issue = (message: string) =>
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["fields", input.name],
            message,
          });
        if (raw === "") {
          if (input.state === "required") issue("Required");
          continue;
        }
        const pattern = patterns.get(input.name);
        if (pattern && !pattern.test(raw))
          issue(input.patternHint ?? "Invalid format");
        if (input.enumValues && !input.enumValues.includes(raw))
          issue(`Must be one of: ${input.enumValues.join(", ")}`);
      }
    });
}

export type TemplateFormValues = z.infer<
  ReturnType<typeof buildTemplateFormSchema>
>;

export function templateFormDefaults(
  template: ConnectionTemplateView,
): TemplateFormValues {
  const fields: Record<string, string> = {};
  for (const i of template.inputs)
    fields[i.name] =
      !i.secret && i.presetValue !== undefined ? i.presetValue : "";
  return {
    name: slugifyTemplateName(template.name),
    overrideDefaults: false,
    fields,
  };
}
