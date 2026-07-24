import { z } from "zod";
import { egressPresetSchema } from "../egress-rules/schemas.js";
import { agentSizeSchema } from "../agents/schemas.js";

/** The KB template selected at create — the installation procedure the fresh
 *  agent bootstraps itself with (surfaced to the user as "Template"). Distinct
 *  from the agent's harness image, which v1 pins. Currently one: LLM Wiki. The
 *  server maps the id to the install command; new procedures extend this enum
 *  and add a mapping. */
export const knowledgeBaseTemplateIdSchema = z.enum(["llm-wiki"]);

/** Create a Knowledge Base: an Agent carrying the `knowledge-base` Kind whose
 *  first session is opened by a platform-composed install instruction (the
 *  agent bootstraps its own knowledge tooling, then interviews the user).
 *  The shape mirrors the agent create input minus everything the KB flow
 *  decides itself (kind, sweepable, gitRepo — the install instruction owns
 *  the repo). Image defaults are a UI concern: the form pins the Claude Code
 *  image; the server accepts any, so a template can override it later. */
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
    // Which installation procedure to bootstrap the agent with. Defaults to
    // the sole current template so older callers keep working.
    kbTemplateId: knowledgeBaseTemplateIdSchema.default("llm-wiki"),
  })
  .refine((d) => d.templateId !== undefined || d.image !== undefined, {
    message: "Either templateId or image is required",
  });
