import type { KnowledgeBaseTemplateId } from "api-server-api";

/** The one-shot shell command a fresh Knowledge Base agent runs in its
 *  workspace at create, delivered over the workspace-command rail. It
 *  bootstraps the agent's knowledge tooling; no agent turn is involved.
 *
 *  Keyed by the KB template the user picked — the seam a new template extends:
 *  add an enum member in the contract and a case here. Each bootstrap installs
 *  a `/wiki-onboard` command (the platform runs it to greet the user), so the
 *  greeting stays template-agnostic. The platform ships the pointer, never the
 *  tooling.
 */
export function buildKnowledgeBaseInstallCommand(
  templateId: KnowledgeBaseTemplateId,
): string {
  switch (templateId) {
    case "llm-wiki":
      return "curl -fsSL https://raw.githubusercontent.com/dam-agents/llm-wiki-v2/main/bootstrap.sh | bash";
    case "plain-wiki":
      return "curl -fsSL https://raw.githubusercontent.com/dam-agents/plain-wiki/main/bootstrap.sh | bash";
  }
}
