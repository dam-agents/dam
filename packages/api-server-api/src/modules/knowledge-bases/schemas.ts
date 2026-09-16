import { z } from "zod";

export const knowledgeBaseTemplateIdSchema = z.enum(["llm-wiki", "plain-wiki"]);

export const knowledgeBaseCreateInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .refine((n) => !n.startsWith("agent-"), {
      message: "agent name cannot start with 'agent-' (reserved for IDs)",
    }),
  templateId: z.string().min(1),
  connectionIds: z.array(z.string()).optional(),
  kbTemplateId: knowledgeBaseTemplateIdSchema.default("llm-wiki"),
});
