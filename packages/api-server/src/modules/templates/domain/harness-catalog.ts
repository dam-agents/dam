import {
  harnessFamilySchema,
  type HarnessCatalog,
  type HarnessView,
  type ProviderPresetType,
} from "api-server-api";
import type { z } from "zod";
import type { harnessCatalogConfigSchema } from "api-server-api";

export const DEFAULT_TEMPLATE_ID = "default";

export const RETIRED_TEMPLATE_HARNESS: Readonly<Record<string, string>> = {
  "claude-code": "claude-code",
  codex: "codex",
  "pi-agent": "pi",
  bob: "bob",
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether a harness can run on a provider type. A
 * harness the catalog does not list (disabled, or unknown) fits nothing; one
 * that names no providers fits every type.
 */
export function harnessFits(
  catalog: Pick<HarnessCatalog, "harnesses">,
  harness: string,
  type: ProviderPresetType,
): boolean {
  const entry = catalog.harnesses.find((h) => h.name === harness);
  return !!entry && (!entry.providers || entry.providers.includes(type));
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the harnesses a session can pick. They all run
 * from the default template's image, so an install without that template
 * offers none.
 */
export function createHarnessCatalog(
  config: z.infer<typeof harnessCatalogConfigSchema>,
  offered: boolean,
): HarnessCatalog {
  const harnesses: HarnessView[] = [];
  for (const [name, entry] of offered ? Object.entries(config.catalog) : []) {
    const family = harnessFamilySchema.safeParse(name);
    if (!family.success) continue;
    const { telemetryEnv: _rail, ...view } = entry;
    harnesses.push({ name: family.data, ...view });
  }
  return {
    default: config.default,
    harnesses,
    telemetryEnv: (harness) => config.catalog[harness]?.telemetryEnv ?? [],
  };
}
