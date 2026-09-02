import { match } from "ts-pattern";
import type { KbHarnessFamily, KnowledgeBaseTemplateId } from "api-server-api";

const LLM_WIKI_BOOTSTRAP_URL =
  "https://raw.githubusercontent.com/dam-agents/llm-wiki-v2/main/bootstrap.sh";

const PLAIN_WIKI_BOOTSTRAP_URL =
  "https://raw.githubusercontent.com/dam-agents/plain-wiki/main/bootstrap.sh";

function bootstrapCommand(
  url: string,
  harnessEnvName: string,
  harnessFamily: KbHarnessFamily | undefined,
): string {
  const runner =
    harnessFamily === undefined
      ? "bash"
      : `${harnessEnvName}=${harnessFamily} bash`;
  return `set -o pipefail; curl -fsSL ${url} | ${runner}`;
}

export function buildKnowledgeBaseInstallCommand(
  templateId: KnowledgeBaseTemplateId,
  harnessFamily: KbHarnessFamily | undefined,
): string {
  return match(templateId)
    .with("llm-wiki", () =>
      bootstrapCommand(
        LLM_WIKI_BOOTSTRAP_URL,
        "LLM_WIKI_HARNESS",
        harnessFamily,
      ),
    )
    .with("plain-wiki", () =>
      bootstrapCommand(
        PLAIN_WIKI_BOOTSTRAP_URL,
        "PLAIN_WIKI_HARNESS",
        harnessFamily,
      ),
    )
    .exhaustive();
}
