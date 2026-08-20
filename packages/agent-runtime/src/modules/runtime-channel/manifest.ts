import { existsSync, readFileSync } from "node:fs";
import {
  contributionKind,
  eventKind,
  harnessConfigCatalog,
  type DriverBinding,
} from "agent-runtime-api";
import { load as parseYaml } from "js-yaml";
import { z } from "zod";

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
  catalog: harnessConfigCatalog.optional(),
  modelDiscovery: z
    .object({
      urlEnv: z.array(z.string().min(1)).nonempty(),
    })
    .optional(),
});
export type HarnessConfigBinding = z.infer<typeof harnessConfigBinding>;

export const runtimeManifestSchema = z.object({
  manifestVersion: z.literal(1),

  drivers: z.record(z.string(), driverEntry).default({}),

  sessionHistory: z
    .object({
      command: z.array(z.string().min(1)).nonempty(),
    })
    .optional(),

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
  "experiment-execute": {
    binding: { impl: "experiment-execute" },
    defaultOn: true,
  },
  "workspace-seed": { binding: { impl: "workspace-seed" }, defaultOn: true },
  "workspace-command": {
    binding: { impl: "workspace-command" },
    defaultOn: true,
  },
  "harness-config": { binding: { impl: "harness-config" }, defaultOn: false },
};

const KNOWN_KINDS = new Set<string>([
  ...contributionKind.options,
  ...eventKind.options,
]);

function defaultImpl(kind: string): string {
  return BUILTIN_DRIVERS[kind]?.binding.impl ?? kind;
}

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
