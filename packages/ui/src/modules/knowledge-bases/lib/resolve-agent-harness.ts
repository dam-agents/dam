import type { TemplateView } from "../../../types.js";
import type { ResolvedHarness } from "../hooks/use-knowledge-base-greeting.js";

export function resolveAgentHarness(
  templateId: string | null,
  templates: { data: TemplateView[] | undefined },
): ResolvedHarness {
  if (templateId === null) return { ready: true, harness: undefined };
  if (templates.data === undefined) return { ready: false };
  return {
    ready: true,
    harness: templates.data.find((t) => t.id === templateId)?.harness,
  };
}
