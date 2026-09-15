import type { KnowledgeBaseTemplateId } from "api-server-api";

export interface KbTemplate {
  id: KnowledgeBaseTemplateId;
  name: string;
  description: string;
  repoUrl: string;
}

export const KB_TEMPLATES: readonly KbTemplate[] = [
  {
    id: "llm-wiki",
    name: "LLM Wiki",
    description:
      "Structured wiki with a knowledge graph, from the llm-wiki toolkit.",
    repoUrl: "https://github.com/dam-agents/llm-wiki-v2",
  },
  {
    id: "plain-wiki",
    name: "Plain Wiki",
    description:
      "Lightweight — the agent asks for files and organizes them for you. Works offline.",
    repoUrl: "https://github.com/dam-agents/plain-wiki",
  },
];

export const DEFAULT_KB_TEMPLATE_ID: KnowledgeBaseTemplateId = "llm-wiki";

export function kbTemplateName(id: string | null): string | null {
  if (!id) return null;
  return KB_TEMPLATES.find((t) => t.id === id)?.name ?? id;
}

export function kbTemplate(id: string): KbTemplate | undefined {
  return KB_TEMPLATES.find((t) => t.id === id);
}
