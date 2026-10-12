import {
  harnessFamilySchema,
  type HarnessCatalog,
  type HarnessView,
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

export { harnessFits } from "api-server-api";

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
