import type { TemplateView } from "../../../types.js";
import { useTemplates } from "../../templates/api/queries.js";

/**
 * Where the sandbox's harness publishes what changed between image versions,
 * as the operator declared it on the template. Null for a template that
 * declares none, for a sandbox built from a raw image, and while the list
 * loads — each hides the link rather than pointing somewhere that can't
 * answer the question.
 */
export function releaseNotesUrl(
  templates: TemplateView[] | undefined,
  templateId: string | null,
): string | null {
  if (!templateId) return null;
  return templates?.find((t) => t.id === templateId)?.releaseNotesUrl ?? null;
}

/** `releaseNotesUrl` for a caller that can reach a hook. */
export function useReleaseNotesUrl(templateId: string | null): string | null {
  const { data: templates } = useTemplates();
  return releaseNotesUrl(templates, templateId);
}
