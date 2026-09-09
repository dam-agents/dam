import type { HarnessFamily, KnowledgeBaseTemplateId } from "api-server-api";

export const KB_TEMPLATE_BOOTSTRAPS: Record<
  KnowledgeBaseTemplateId,
  { url: string; harnessEnv: string }
> = {
  "llm-wiki": {
    url: "https://raw.githubusercontent.com/dam-agents/llm-wiki-v2/main/bootstrap.sh",
    harnessEnv: "LLM_WIKI_HARNESS",
  },
  "plain-wiki": {
    url: "https://raw.githubusercontent.com/dam-agents/plain-wiki/main/bootstrap.sh",
    harnessEnv: "PLAIN_WIKI_HARNESS",
  },
};

export function buildKnowledgeBaseInstallCommand(
  templateId: KnowledgeBaseTemplateId,
  harnessFamily: HarnessFamily | undefined,
): string {
  const { url, harnessEnv } = KB_TEMPLATE_BOOTSTRAPS[templateId];
  const runner =
    harnessFamily === undefined
      ? "bash"
      : `${harnessEnv}=${harnessFamily} bash`;
  return `set -o pipefail; curl -fsSL ${url} | ${runner}`;
}
