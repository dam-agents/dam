import type { HarnessCapability } from "agent-runtime-api";
import {
  PROVIDER_PRESET_TYPES,
  PROVIDERS,
  type ProviderPresetType,
} from "../connections/providers.js";
import type { HarnessView } from "../templates/types.js";
import { modelDialect, type ModelDialect } from "./dialects.js";
import { listingForTemplate, PROVIDER_DIALECTS } from "./provider-listing.js";

export type AgentHarnessView = Omit<HarnessView, "name"> & { name: string };

const imageHarnessProviders = (
  dialects: readonly ModelDialect[],
): ProviderPresetType[] =>
  PROVIDER_PRESET_TYPES.filter(
    (type) =>
      PROVIDER_DIALECTS[PROVIDERS[type].alias].some((d) =>
        dialects.includes(d),
      ) &&
      PROVIDERS[type].modes.some(
        (mode) => !listingForTemplate(mode.templateId)?.harnesses,
      ),
  );

/**
 * UNIT_BOUNDARY_DESCRIPTION: the harnesses one agent can run, which are the
 * install's harness catalog plus each **image harness** its runtime reports:
 * a harness the agent's own image carries that the catalog does not list.
 * Such a harness is described by its own manifest, as hello reports it: its
 * name is its ACP agent's title, and it fits each provider that serves one
 * of its model dialects and is not kept to named harnesses. A reported
 * harness with no dialect the platform knows is not routed, so it is left
 * out. No harness is named here, so any image's harness is treated alike.
 */
export function withImageHarnesses(
  catalog: { harnesses: readonly HarnessView[] },
  carried: readonly HarnessCapability[] | null | undefined,
): AgentHarnessView[] {
  const listed = new Set(catalog.harnesses.map((h) => h.name as string));
  const images = (carried ?? []).flatMap((h): AgentHarnessView[] => {
    if (listed.has(h.name)) return [];
    const dialects = (h.dialects ?? []).flatMap((d) => {
      const known = modelDialect.safeParse(d);
      return known.success ? [known.data] : [];
    });
    if (dialects.length === 0) return [];
    return [
      {
        name: h.name,
        displayName: h.title ?? h.name,
        providers: imageHarnessProviders(dialects),
        tags: [],
        experimental: false,
      },
    ];
  });
  return [...catalog.harnesses, ...images];
}
