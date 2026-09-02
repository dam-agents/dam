import type { z } from "zod";
import type { Agent } from "../agents/types.js";
import type {
  kbHarnessFamilySchema,
  knowledgeBaseCreateInputSchema,
  knowledgeBaseTemplateIdSchema,
} from "./schemas.js";

export type KnowledgeBaseCreateInput = z.infer<
  typeof knowledgeBaseCreateInputSchema
>;

export type KnowledgeBaseTemplateId = z.infer<
  typeof knowledgeBaseTemplateIdSchema
>;

export type KbHarnessFamily = z.infer<typeof kbHarnessFamilySchema>;

export interface KnowledgeBasesService {
  create(input: KnowledgeBaseCreateInput): Promise<Agent>;
}
