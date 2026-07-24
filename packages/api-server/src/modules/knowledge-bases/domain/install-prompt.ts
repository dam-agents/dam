/** The one-shot instruction a fresh Knowledge Base agent receives as its first
 *  prompt, delivered over the trigger rail at create. The agent bootstraps its
 *  own knowledge tooling from the referenced repo, then rolls straight into
 *  the onboarding interview — the platform ships the pointer, never the
 *  tooling itself.
 *
 *  v1 pins the LLM Wiki bootstrap for every Knowledge Base; the prompt is
 *  meant to become a Template concern (each KB template carrying its own
 *  install instruction) once KB templates exist. */
export function buildKnowledgeBaseInstallPrompt(): string {
  return [
    "Install yourself as the LLM Wiki agent. From your current working directory, fetch",
    "https://raw.githubusercontent.com/dam-agents/llm-wiki-v2/main/INSTALLATION.md",
    "and follow it exactly, step by step — bootstrap the repo from",
    "https://github.com/dam-agents/llm-wiki-v2.git into this directory, run the",
    "installer, verify, then continue straight into the onboarding interview with me.",
  ].join("\n");
}
