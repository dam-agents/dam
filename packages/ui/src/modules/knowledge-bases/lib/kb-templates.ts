import type { KnowledgeBaseTemplateId } from "api-server-api";

export interface KbTemplate {
  id: KnowledgeBaseTemplateId;
  name: string;
  description: string;
}

/** The installation procedures a knowledge base can start from. The id set is
 *  the contract's `knowledgeBaseTemplateIdSchema`; this adds the researcher-
 *  facing copy. One today — the server maps the id to the bootstrap command. */
export const KB_TEMPLATES: readonly KbTemplate[] = [
  {
    id: "llm-wiki",
    name: "LLM Wiki",
    description:
      "Installs the LLM Wiki toolkit and keeps an interlinked, self-maintaining knowledge wiki as you feed it sources.",
  },
];

export const DEFAULT_KB_TEMPLATE_ID: KnowledgeBaseTemplateId = "llm-wiki";
