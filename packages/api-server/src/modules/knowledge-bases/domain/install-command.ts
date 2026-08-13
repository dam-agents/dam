import type { KnowledgeBaseTemplateId } from "api-server-api";

export function buildKnowledgeBaseInstallCommand(
  templateId: KnowledgeBaseTemplateId,
): string {
  switch (templateId) {
    case "llm-wiki":
      return "set -o pipefail; curl -fsSL https://raw.githubusercontent.com/dam-agents/llm-wiki-v2/main/bootstrap.sh | bash";
    case "plain-wiki":
      return "set -o pipefail; curl -fsSL https://raw.githubusercontent.com/dam-agents/plain-wiki/main/bootstrap.sh | bash";
  }
}
