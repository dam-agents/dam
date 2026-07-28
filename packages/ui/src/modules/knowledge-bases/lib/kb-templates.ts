import type { KnowledgeBaseTemplateId } from "api-server-api";

export interface KbTemplate {
  id: KnowledgeBaseTemplateId;
  name: string;
  description: string;
}

/** The installation procedures a knowledge base can start from. The id set is
 *  the contract's `knowledgeBaseTemplateIdSchema`; this adds the researcher-
 *  facing copy. The server maps each id to its bootstrap command. */
export const KB_TEMPLATES: readonly KbTemplate[] = [
  {
    id: "llm-wiki",
    name: "LLM Wiki",
    description:
      "Installs the LLM Wiki toolkit and keeps an interlinked, self-maintaining knowledge wiki as you feed it sources.",
  },
  {
    id: "plain-wiki",
    name: "Plain Wiki",
    description:
      "No toolkit — the agent reads your files as knowledge and keeps what it learns as plain markdown notes. Works offline.",
  },
];

export const DEFAULT_KB_TEMPLATE_ID: KnowledgeBaseTemplateId = "llm-wiki";

/** Display name for a KB template id. An unknown id (a newer writer) shows
 *  as-is rather than disappearing; null (a KB created before the id was
 *  stamped) stays null so callers can omit the segment. */
export function kbTemplateName(id: string | null): string | null {
  if (!id) return null;
  return KB_TEMPLATES.find((t) => t.id === id)?.name ?? id;
}
