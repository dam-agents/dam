import type { TemplateView } from "../../../types.js";

interface Catalogue {
  showVmToggle: boolean;
  vmSelected: boolean;
  harnesses: TemplateView[];
  preconfigured: TemplateView[];
}

/** What step 1 of the create-sandbox wizard offers. VM-backed templates stay
 *  invisible until the vm-sandboxes feature reveals the switch, so they can
 *  never be picked by someone who hasn't opted in — the toggle is the only way
 *  to reach them, and `vm` alone doesn't unlock it. */
export function imageCatalogue(
  templates: TemplateView[],
  { vm, vmFeatureEnabled }: { vm: boolean; vmFeatureEnabled: boolean },
): Catalogue {
  const showVmToggle = vmFeatureEnabled && templates.some((t) => t.vm);
  const vmSelected = showVmToggle && vm;
  const visible = templates.filter((t) => t.vm === vmSelected);
  return {
    showVmToggle,
    vmSelected,
    harnesses: visible.filter((t) => t.category === "harness"),
    preconfigured: visible.filter((t) => t.category === "preconfigured"),
  };
}
