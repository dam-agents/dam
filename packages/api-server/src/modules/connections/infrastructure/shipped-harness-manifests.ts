import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { HarnessCapability } from "agent-runtime-api";
import { harnessConfigCatalog } from "agent-runtime-api";
import { load } from "js-yaml";
import { z } from "zod";

const sessionSetting = z.looseObject({
  mode: z.literal(true).optional(),
  deriveStartMode: z.literal(true).optional(),
});

const harnessConfigBinding = z.looseObject({
  sessionModel: z.boolean().optional(),
  sessionSettings: z.record(z.string(), z.unknown()).optional(),
  catalog: harnessConfigCatalog.optional(),
});

const shippedManifest = z.looseObject({
  modelRouter: z
    .looseObject({
      native: z
        .object({
          templates: z.array(z.string().min(1)).nonempty(),
          models: z.array(z.string().min(1)).nonempty(),
        })
        .optional(),
    })
    .optional(),
  drivers: z.record(z.string(), z.unknown()).default({}),
});

export interface ShippedHarnessFacts {
  name: string;
  modelRouter: boolean;
  native?: {
    templates: readonly string[];
    models: readonly string[];
  };
  harnessConfig: boolean;
  sessionModel: boolean;
  catalog?: z.infer<typeof harnessConfigCatalog>;
  sessionSettings?: string[];
  derivedStartMode?: string[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the facts an owner-level reader needs from the
 * harness manifests baked into the api-server image: the settings catalog the
 * runtime advertises on hello, and the templates each harness runs natively
 * instead of through the Model Router. A manifest the image lacks leaves that
 * harness with no capabilities rather than failing the catalog.
 */
export function loadShippedHarnessFacts(
  opts: {
    dir?: string;
    log?: (message: string) => void;
  } = {},
): Record<string, ShippedHarnessFacts> {
  const log = opts.log ?? (() => {});
  const files = manifestFiles(opts.dir);
  const facts: Record<string, ShippedHarnessFacts> = {};
  for (const { name, path } of files) {
    let raw: unknown;
    try {
      raw = load(readFileSync(path, "utf8"));
    } catch (err) {
      log(`[harness-manifests] ${path}: ${(err as Error).message}`);
      continue;
    }
    const parsed = shippedManifest.safeParse(raw);
    if (!parsed.success) {
      log(`[harness-manifests] ${path}: ${parsed.error.message}`);
      continue;
    }
    const binding = harnessConfigBinding.safeParse(
      parsed.data.drivers["harness-config"],
    );
    const config = binding.success ? binding.data : null;
    const settings = config?.sessionSettings
      ? Object.keys(config.sessionSettings)
      : undefined;
    const derived = config?.sessionSettings
      ? Object.entries(config.sessionSettings).flatMap(([id, setting]) => {
          const parsedSetting = sessionSetting.safeParse(setting);
          return parsedSetting.success &&
            parsedSetting.data.mode === true &&
            parsedSetting.data.deriveStartMode === true
            ? [id]
            : [];
        })
      : undefined;
    facts[name] = {
      name,
      modelRouter: parsed.data.modelRouter !== undefined,
      ...(parsed.data.modelRouter?.native && {
        native: parsed.data.modelRouter.native,
      }),
      harnessConfig: config !== null,
      sessionModel: config?.sessionModel === true,
      ...(config?.catalog && { catalog: config.catalog }),
      ...(settings?.length && { sessionSettings: settings }),
      ...(derived?.length && { derivedStartMode: derived }),
    };
  }
  return facts;
}

function manifestFiles(
  dir: string | undefined,
): { name: string; path: string }[] {
  const candidates = [
    dir,
    process.env.PLATFORM_HARNESS_MANIFESTS_DIR,
    join(process.cwd(), "runtime-manifests"),
    join(process.cwd(), "app/runtime-manifests"),
    join(process.cwd(), "../agents"),
  ].filter((c): c is string => c !== undefined);
  for (const candidate of candidates) {
    const files = filesUnder(candidate);
    if (files.length > 0) return files;
  }
  return [];
}

function filesUnder(dir: string): { name: string; path: string }[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const flat = entries
    .filter((e) => e.isFile() && e.name.endsWith(".yaml"))
    .map((e) => ({
      name: basename(e.name, ".yaml"),
      path: join(dir, e.name),
    }));
  if (flat.length > 0) return flat;
  return entries.flatMap((e) => {
    if (!e.isDirectory()) return [];
    const path = join(dir, e.name, "rootfs/app/runtime-manifest.yaml");
    if (!existsSync(path)) return [];
    const image = join(dir, e.name, "image.toml");
    const harness = existsSync(image)
      ? /^PLATFORM_HARNESS = "(.*)"$/m.exec(readFileSync(image, "utf8"))?.[1]
      : undefined;
    return [{ name: harness || e.name, path }];
  });
}

export function harnessCapabilityOf(
  facts: ShippedHarnessFacts,
): HarnessCapability {
  return {
    name: facts.name,
    harnessConfig: facts.harnessConfig,
    ...(facts.catalog && { harnessConfigCatalog: facts.catalog }),
    sessionModel: facts.sessionModel,
    ...(facts.sessionSettings && { sessionSettings: facts.sessionSettings }),
    ...(facts.derivedStartMode && {
      derivedStartMode: facts.derivedStartMode,
    }),
    ...(facts.native?.templates.length && {
      nativeTemplates: [...facts.native.templates],
    }),
    ...(facts.sessionSettings && { platformSubagentSettings: true }),
  };
}
