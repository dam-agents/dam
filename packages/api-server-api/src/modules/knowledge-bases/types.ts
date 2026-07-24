import type { z } from "zod";
import type { Agent } from "../agents/types.js";
import type { knowledgeBaseCreateInputSchema } from "./schemas.js";

export type KnowledgeBaseCreateInput = z.infer<
  typeof knowledgeBaseCreateInputSchema
>;

/** Owner-scoped Knowledge Bases service. A Knowledge Base is an Agent with
 *  the `knowledge-base` Kind: reads ride the agents surface (the UI filters
 *  the agent list on Kind), so the service owns only what plain agent
 *  creation cannot do — pairing the create with the one-shot install
 *  instruction delivered over the trigger rail. */
export interface KnowledgeBasesService {
  create(input: KnowledgeBaseCreateInput): Promise<Agent>;
}
