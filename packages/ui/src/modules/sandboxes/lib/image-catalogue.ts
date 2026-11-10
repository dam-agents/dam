import type { TemplateView } from "../../../types.js";
import { SHARED_IMAGE_TEMPLATE_ID } from "../../templates/lib/harness-templates.js";

const KINDED_HARNESS_TEMPLATE_ID = "claude-code";

interface Catalogue {
  harnesses: TemplateView[];
}

export function imageCatalogue(templates: TemplateView[]): Catalogue {
  return {
    harnesses: templates.filter(
      (t) => t.category === "harness" && t.id !== SHARED_IMAGE_TEMPLATE_ID,
    ),
  };
}

export function defaultHarnessId(
  harnesses: TemplateView[],
  preferred?: string,
): string | null {
  if (preferred && harnesses.some((t) => t.id === preferred)) return preferred;
  if (harnesses.some((t) => t.id === KINDED_HARNESS_TEMPLATE_ID)) {
    return KINDED_HARNESS_TEMPLATE_ID;
  }
  return harnesses[0]?.id ?? null;
}

export function reconcileHarnessSelection(
  harnesses: TemplateView[],
  templateId: string | null,
  { allowNone, preferred }: { allowNone: boolean; preferred?: string },
): { templateId: string | null } | null {
  if (templateId !== null) {
    if (harnesses.some((t) => t.id === templateId)) return null;
    return {
      templateId: allowNone ? null : defaultHarnessId(harnesses, preferred),
    };
  }
  if (allowNone) return null;
  const fallback = defaultHarnessId(harnesses, preferred);
  return fallback === null ? null : { templateId: fallback };
}
