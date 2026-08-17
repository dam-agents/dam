import type { TemplateView } from "../../../types.js";
import { useTemplates } from "../../templates/api/queries.js";

export function releaseNotesUrl(
  templates: TemplateView[] | undefined,
  templateId: string | null,
): string | null {
  if (!templateId) return null;
  return templates?.find((t) => t.id === templateId)?.releaseNotesUrl ?? null;
}

export function useReleaseNotesUrl(templateId: string | null): string | null {
  const { data: templates } = useTemplates();
  return releaseNotesUrl(templates, templateId);
}
