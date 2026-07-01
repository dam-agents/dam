import { existsSync, readFileSync } from "node:fs";
import {
  contributionKind,
  eventKind,
  harnessConfigCatalog,
  type DriverBinding,
} from "agent-runtime-api";
import { load as parseYaml } from "js-yaml";
import { z } from "zod";

// `impl` is optional (defaults to the kind's built-in impl); `false` disables a built-in.
const driverEntry = z.union([
  z.object({ impl: z.string().min(1).optional() }).catchall(z.unknown()),
  z.literal(false),
]);

const extensionImpl = z.object({
  name: z.string().min(1),
  module: z.string().min(1),
  export: z.string().min(1),
});
export type ExtensionImpl = z.infer<typeof extensionImpl>;

// The harness-config driver binding: the config file + the dot-path each logical
// field (model/mode/configOption id) maps to. See docs/architecture/connections.md.
export const harnessConfigBinding = z.object({
  file: z.string().min(1),
  format: z.enum(["json", "toml"]).default("json"),
  keys: z
    .object({
      model: z.string().min(1).optional(),
      mode: z.string().min(1).optional(),
      configOptions: z.record(z.string().min(1), z.string().min(1)).optional(),
    })
    .refine(
      (k) =>
        k.model !== undefined ||
        k.mode !== undefined ||
        k.configOptions !== undefined,
      {
        message:
          "harnessConfig.keys must map at least one of model/mode/configOptions",
      },
    ),
  // Option catalog advertised on `hello` (optional — a harness can map keys
  // without presenting one).
  catalog: harnessConfigCatalog.optional(),
  // Optional live model discovery for harnesses whose models are connection-
  // dependent (e.g. pi behind a proxy). See docs/architecture/connections.md.
  modelDiscovery: z
    .object({
      // Env vars that may hold the provider base URL; first set wins.
      urlEnv: z.array(z.string().min(1)).nonempty(),
    })
    .optional(),
});
export type HarnessConfigBinding = z.infer<typeof harnessConfigBinding>;

export const runtimeManifestSchema = z.object({
  manifestVersion: z.literal(1),

  // Every kind (contribution or event) is a driver entry; omitted built-ins fall
  // back to defaults (see `resolveDrivers`).
  drivers: z.record(z.string(), driverEntry).default({}),

  extensions: z
    .object({
      impls: z.array(extensionImpl).default([]),
    })
    .optional(),
});
export type RuntimeManifest = z.infer<typeof runtimeManifestSchema>;

export class ManifestLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestLoadError";
  }
}

export function loadManifest(path: string): RuntimeManifest {
  if (!existsSync(path)) {
    throw new ManifestLoadError(`runtime-manifest.yaml not found at ${path}`);
  }
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf8"));
  } catch (err) {
    throw new ManifestLoadError(
      `failed to parse ${path}: ${(err as Error).message}`,
    );
  }
  const parsed = runtimeManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ManifestLoadError(
      `invalid runtime-manifest.yaml at ${path}: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

// Built-in drivers. `defaultOn` kinds are active even when the manifest omits
// them; `harness-config` is off until declared (it needs a per-harness binding),
// but its impl lives here too, so resolution never falls back to the kind name.
const BUILTIN_DRIVERS: Record<
  string,
  { binding: DriverBinding; defaultOn: boolean }
> = {
  env: { binding: { impl: "env" }, defaultOn: true },
  file: { binding: { impl: "file" }, defaultOn: true },
  "mcp-entry": {
    binding: {
      impl: "mcp-entry",
      path: "$HOME/.mcp.json",
      keyPath: "mcpServers",
    },
    defaultOn: true,
  },
  "skill-ref": {
    binding: { impl: "skill-install", paths: ["$HOME/.agents/skills"] },
    defaultOn: true,
  },
  trigger: { binding: { impl: "trigger" }, defaultOn: true },
  "schedule-reset": { binding: { impl: "trigger" }, defaultOn: true },
  "experiment-trigger": {
    binding: { impl: "experiment-trigger" },
    defaultOn: true,
  },
  "workspace-seed": { binding: { impl: "workspace-seed" }, defaultOn: true },
  "harness-config": { binding: { impl: "harness-config" }, defaultOn: false },
};

const KNOWN_KINDS = new Set<string>([
  ...contributionKind.options,
  ...eventKind.options,
]);

function defaultImpl(kind: string): string {
  return BUILTIN_DRIVERS[kind]?.binding.impl ?? kind;
}

// Effective bindings: the default-on built-ins, plus declarations (impl filled
// from the kind), minus `false` disables. Throws on an unknown kind.
export function resolveDrivers(
  manifest: RuntimeManifest,
): Record<string, DriverBinding> {
  const out: Record<string, DriverBinding> = {};
  for (const [kind, d] of Object.entries(BUILTIN_DRIVERS)) {
    if (d.defaultOn) out[kind] = d.binding;
  }
  for (const [kind, entry] of Object.entries(manifest.drivers)) {
    if (!KNOWN_KINDS.has(kind)) {
      throw new ManifestLoadError(
        `unknown driver kind "${kind}" — not a contribution or event kind`,
      );
    }
    if (entry === false) {
      delete out[kind];
      continue;
    }
    out[kind] = { ...entry, impl: entry.impl ?? defaultImpl(kind) };
  }
  return out;
}

export function contributionDrivers(
  resolved: Record<string, DriverBinding>,
): Record<string, DriverBinding> {
  return pickKinds(resolved, contributionKind.options);
}

export function eventDrivers(
  resolved: Record<string, DriverBinding>,
): Record<string, DriverBinding> {
  return pickKinds(resolved, eventKind.options);
}

function pickKinds(
  resolved: Record<string, DriverBinding>,
  kinds: readonly string[],
): Record<string, DriverBinding> {
  const allow = new Set<string>(kinds);
  return Object.fromEntries(
    Object.entries(resolved).filter(([k]) => allow.has(k)),
  );
}
