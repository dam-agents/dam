import type { TemplateView } from "../../../types.js";

export const KINDED_HARNESS_TEMPLATE_ID = "claude-code";

interface Catalogue {
  harnesses: TemplateView[];
}

export function imageCatalogue(
  templates: TemplateView[],
  { vmFeatureEnabled }: { vmFeatureEnabled: boolean },
): Catalogue {
  const visible = vmFeatureEnabled ? templates : templates.filter((t) => !t.vm);
  return { harnesses: visible.filter((t) => t.category === "harness") };
}
