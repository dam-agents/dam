/** The one-shot shell command a fresh Knowledge Base agent runs in its
 *  workspace at create, delivered over the workspace-command rail. It
 *  bootstraps the agent's knowledge tooling; no agent turn is involved.
 *
 *  v1 pins the LLM Wiki bootstrap for every Knowledge Base; this is meant to
 *  become a Template concern (each KB template carrying its own bootstrap)
 *  once KB templates exist. The platform ships the pointer, never the tooling.
 */
export function buildKnowledgeBaseInstallCommand(): string {
  return "curl -fsSL https://raw.githubusercontent.com/dam-agents/llm-wiki-v2/main/bootstrap.sh | bash";
}
