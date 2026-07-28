import type { TemplateView } from "../../../types.js";

interface Catalogue {
  harnesses: TemplateView[];
  preconfigured: TemplateView[];
}

/** What the create-sandbox wizard offers. VM-backed templates sit in the same
 *  lists as container ones — each carries its own "VM" tag, so choosing one is
 *  the whole decision and needs no separate switch — but they stay hidden
 *  entirely until the vm-sandboxes feature is on, so they cannot be picked by
 *  anyone who has not opted in. */
export function imageCatalogue(
  templates: TemplateView[],
  { vmFeatureEnabled }: { vmFeatureEnabled: boolean },
): Catalogue {
  const visible = vmFeatureEnabled ? templates : templates.filter((t) => !t.vm);
  return {
    harnesses: visible.filter((t) => t.category === "harness"),
    preconfigured: visible.filter((t) => t.category === "preconfigured"),
  };
}
