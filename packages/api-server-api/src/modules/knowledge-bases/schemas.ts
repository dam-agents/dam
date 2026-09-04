import { z } from "zod";
import { egressPresetSchema } from "../egress-rules/schemas.js";
import { agentSizeSchema } from "../agents/schemas.js";

export const knowledgeBaseTemplateIdSchema = z.enum(["llm-wiki", "plain-wiki"]);

export const kbHarnessFamilySchema = z.enum([
  "claude-code",
  "codex",
  "pi",
  "bob",
]);

export function parseKbHarnessFamily(
  harness: string | undefined,
): z.infer<typeof kbHarnessFamilySchema> | undefined {
  const parsed = kbHarnessFamilySchema.safeParse(harness);
  return parsed.success ? parsed.data : undefined;
}

export const knowledgeBaseCreateInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .refine((n) => !n.startsWith("agent-"), {
        message: "agent name cannot start with 'agent-' (reserved for IDs)",
      }),
    templateId: z.string().optional(),
    image: z.string().optional(),
    description: z.string().optional(),
    connectionIds: z.array(z.string()).optional(),
    egressPreset: egressPresetSchema.optional(),
    size: agentSizeSchema.optional(),
    kbTemplateId: knowledgeBaseTemplateIdSchema.default("llm-wiki"),
  })
  .refine((d) => d.templateId !== undefined || d.image !== undefined, {
    message: "Either templateId or image is required",
  });
