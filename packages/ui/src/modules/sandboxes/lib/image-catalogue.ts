import type { TemplateView } from "../../../types.js";

const KINDED_HARNESS_TEMPLATE_ID = "claude-code";

interface Catalogue {
  harnesses: TemplateView[];
}

export function imageCatalogue(templates: TemplateView[]): Catalogue {
  return { harnesses: templates.filter((t) => t.category === "harness") };
}

export function defaultHarnessId(harnesses: TemplateView[]): string | null {
  if (harnesses.some((t) => t.id === KINDED_HARNESS_TEMPLATE_ID)) {
    return KINDED_HARNESS_TEMPLATE_ID;
  }
  return harnesses[0]?.id ?? null;
}

export function reconcileHarnessSelection(
  harnesses: TemplateView[],
  templateId: string | null,
  { allowNone }: { allowNone: boolean },
): { templateId: string | null } | null {
  if (templateId !== null) {
    if (harnesses.some((t) => t.id === templateId)) return null;
    return { templateId: allowNone ? null : defaultHarnessId(harnesses) };
  }
  if (allowNone) return null;
  const fallback = defaultHarnessId(harnesses);
  return fallback === null ? null : { templateId: fallback };
}
