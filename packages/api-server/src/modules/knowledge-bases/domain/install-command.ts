import type { KnowledgeBaseTemplateId } from "api-server-api";

/** The one-shot shell command a fresh Knowledge Base agent runs in its
 *  workspace at create, delivered over the workspace-command rail. It
 *  bootstraps the agent's knowledge tooling; no agent turn is involved.
 *
 *  Keyed by the KB template the user picked. Today there is one — LLM Wiki —
 *  but the mapping is the seam a new template extends: add an enum member in
 *  the contract and a case here. The platform ships the pointer, never the
 *  tooling.
 */
export function buildKnowledgeBaseInstallCommand(
  templateId: KnowledgeBaseTemplateId,
): string {
  switch (templateId) {
    case "llm-wiki":
      return "curl -fsSL https://raw.githubusercontent.com/dam-agents/llm-wiki-v2/main/bootstrap.sh | bash";
  }
}
