import type { TemplateView } from "../../../types.js";

const DEFAULT_TEMPLATE_ID = "default";

interface Catalogue {
  harnesses: TemplateView[];
}

export function imageCatalogue(templates: TemplateView[]): Catalogue {
  return { harnesses: templates.filter((t) => t.category === "harness") };
}

export function defaultHarnessId(harnesses: TemplateView[]): string | null {
  if (harnesses.some((t) => t.id === DEFAULT_TEMPLATE_ID)) {
    return DEFAULT_TEMPLATE_ID;
  }
  return harnesses[0]?.id ?? null;
}
