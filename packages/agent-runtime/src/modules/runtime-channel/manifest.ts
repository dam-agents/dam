import { existsSync, readFileSync } from "node:fs";
import {
  contributionKind,
  eventKind,
  harnessConfigCatalog,
  type DriverBinding,
} from "agent-runtime-api";
import { loadYamlDocument } from "../../core/yaml-document.js";
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

const modelListing = z.object({
  path: z.string().startsWith("/").optional(),
  shape: z
    .enum(["openai-models", "litellm-model-info", "bedrock-inference-profiles"])
    .optional(),
});

export const modelDiscoverySpec = modelListing.extend({
  urlEnv: z.array(z.string().min(1)).nonempty(),
  tokenEnv: z.array(z.string().min(1)).optional(),
  credentialHeader: z.enum(["authorization", "x-api-key"]).optional(),
  headers: z.record(z.string().min(1), z.string()).optional(),
  redirectEnv: z.array(z.string().min(1)).optional(),
  pinEnv: z.array(z.string().min(1)).optional(),
  namePrefix: z.string().min(1).optional(),
  lowercaseNames: z.boolean().optional(),
  extendsCatalog: z.boolean().optional(),
  fallback: modelListing.optional(),
});
export type ModelDiscoverySpec = z.infer<typeof modelDiscoverySpec>;

export const modelDiscoverySources = z.union([
  modelDiscoverySpec,
  z.array(modelDiscoverySpec).nonempty(),
]);
export type ModelDiscoverySources = z.infer<typeof modelDiscoverySources>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: how a session setting reaches the harness. An
 * `env` setting is read at process start, so a session that picks one runs
 * in a process of its own; a `router` setting is never sent, the Model
 * Router reads the session's value itself on every call. A `mode` setting that
 * opts in with `deriveStartMode` has no start mode of its own the runtime can
 * rely on, so the runtime derives one from the catalog and the session's
 * model; every other harness starts on its own, and its own sources of a start
 * mode — a thinking level, a pinned persona — are left alone.
 */
export const sessionSettingBinding = z.union([
  z.object({
    mode: z.literal(true),
    deriveStartMode: z.literal(true).optional(),
  }),
  z.object({ configOption: z.string().min(1) }),
  z.object({ env: z.array(z.string().min(1)).nonempty() }),
  z.object({ router: z.literal(true) }),
]);
export type SessionSettingBinding = z.infer<typeof sessionSettingBinding>;

export const harnessConfigBinding = z.object({
  file: z.string().min(1),
  sessionModel: z.boolean().optional(),
  sessionSettings: z
    .record(z.string().min(1), sessionSettingBinding)
    .optional(),
  format: z.enum(["json", "toml"]).default("json"),
  keys: z
    .object({
      model: z.string().min(1).optional(),
      mode: z.string().min(1).optional(),
      configOptions: z
        .record(
          z.string().min(1),
          z.union([z.string().min(1), z.array(z.string().min(1)).nonempty()]),
        )
        .optional(),
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
  modelDiscovery: modelDiscoverySources.optional(),
  defaultModel: z.string().min(1).optional(),
});
export type HarnessConfigBinding = z.infer<typeof harnessConfigBinding>;

export const modelDialect = z.enum([
  "anthropic-messages",
  "openai-chat",
  "openai-responses",
]);
export type ModelDialect = z.infer<typeof modelDialect>;

export const sessionModelBinding = z.object({
  configOption: z.string().min(1),
  valuePrefix: z.string().optional(),
});
export type SessionModelBinding = z.infer<typeof sessionModelBinding>;

export const initializeCapabilities = z.object({
  agentCapabilities: z.record(z.string(), z.unknown()),
  authMethods: z.array(z.unknown()).default([]),
  agentInfo: z
    .object({ name: z.string().min(1), title: z.string().min(1) })
    .optional(),
});
export type InitializeCapabilities = z.infer<typeof initializeCapabilities>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: providers a harness runs on outside the Model
 * Router (Claude Code on Bedrock, whose SigV4 signing no header swap can do):
 * a session on one runs in a process of its own with the Connection's env.
 */
export const nativeProvidersBinding = z.object({
  templates: z.array(z.string().min(1)).nonempty(),
  models: z.array(z.string().min(1)).nonempty(),
});
export type NativeProvidersBinding = z.infer<typeof nativeProvidersBinding>;

export const modelRouterBinding = z.object({
  dialects: z.array(modelDialect).nonempty(),
  native: nativeProvidersBinding.optional(),
  sessionModel: sessionModelBinding.optional(),
  namePrefix: z.string().min(1).optional(),
  lowercaseNames: z.boolean().optional(),
  modelFromSession: z.boolean().optional(),
  tierAliases: z.array(z.string().min(1)).optional(),
  bareNamesFromSession: z.boolean().optional(),
  claudeTiers: z.boolean().optional(),
  credentialEnv: z.array(z.string().min(1)).optional(),
  defaultModelEnv: z.array(z.string().min(1)).optional(),
  sessionFromRunningTurn: z.boolean().optional(),
  bobGateway: z.boolean().optional(),
  nonClaudeModelEnv: z
    .record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/), z.string())
    .optional(),
});
export type ModelRouterBinding = z.infer<typeof modelRouterBinding>;

export const runtimeManifestSchema = z.object({
  manifestVersion: z.literal(1),

  modelRouter: modelRouterBinding.optional(),

  initializeCapabilities: initializeCapabilities.optional(),

  harnessState: z.enum(["claude-code"]).optional(),

  drivers: z.record(z.string(), driverEntry).default({}),

  sessionHistory: z
    .object({
      module: z.string().min(1).optional(),
      exportName: z.string().min(1).optional(),
      command: z.array(z.string().min(1)).nonempty().optional(),
    })
    .refine((h) => (h.module !== undefined) !== (h.command !== undefined), {
      message: "sessionHistory needs exactly one of module or command",
    })
    .optional(),

  terminalSessionPins: z.string().min(1).optional(),

  sessionMcpEntry: z.boolean().default(true),

  sessionEnvVar: z
    .string()
    .regex(/^[A-Z_][A-Z0-9_]*$/)
    .optional(),

  agentProcesses: z.array(z.string().min(1).max(15)).default([]),

  extensions: z
    .object({
      impls: z.array(extensionImpl).default([]),
    })
    .optional(),
});
export type RuntimeManifest = z.infer<typeof runtimeManifestSchema>;

export function loadManifest(path: string): RuntimeManifest {
  if (!existsSync(path)) {
    throw new Error(`runtime-manifest.yaml not found at ${path}`);
  }
  let raw: unknown;
  try {
    raw = loadYamlDocument(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`failed to parse ${path}: ${(err as Error).message}`);
  }
  const parsed = runtimeManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
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
  initialization: { binding: { impl: "initialization" }, defaultOn: true },
  "workspace-seed": { binding: { impl: "workspace-seed" }, defaultOn: true },
  "workspace-command": {
    binding: { impl: "workspace-command" },
    defaultOn: true,
  },
  "harness-config": { binding: { impl: "harness-config" }, defaultOn: false },
  "satellite-outcome": {
    binding: { impl: "satellite-outcome" },
    defaultOn: true,
  },
  "sub-agent-outcome": {
    binding: { impl: "sub-agent-outcome" },
    defaultOn: true,
  },
  "session-message": {
    binding: { impl: "session-message" },
    defaultOn: true,
  },
  "session-defaults": {
    binding: { impl: "session-defaults" },
    defaultOn: true,
  },
  "startup-items": {
    binding: { impl: "startup-items" },
    defaultOn: true,
  },
};

const KNOWN_KINDS = new Set<string>([
  ...contributionKind.options,
  ...eventKind.options,
]);

export function resolveDrivers(
  manifest: RuntimeManifest,
): Record<string, DriverBinding> {
  const out: Record<string, DriverBinding> = {};
  for (const [kind, d] of Object.entries(BUILTIN_DRIVERS)) {
    if (d.defaultOn) out[kind] = d.binding;
  }
  for (const [kind, entry] of Object.entries(manifest.drivers)) {
    if (!KNOWN_KINDS.has(kind)) {
      throw new Error(
        `unknown driver kind "${kind}" — not a contribution or event kind`,
      );
    }
    if (entry === false) {
      delete out[kind];
      continue;
    }
    out[kind] = {
      ...entry,
      impl: entry.impl ?? BUILTIN_DRIVERS[kind]?.binding.impl ?? kind,
    };
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

export function sessionModelOf(manifest: RuntimeManifest): boolean {
  const raw = resolveDrivers(manifest)["harness-config"];
  return raw ? harnessConfigBinding.parse(raw).sessionModel === true : false;
}

export function harnessConfigBindingOf(
  manifest: RuntimeManifest,
): HarnessConfigBinding | undefined {
  const raw = resolveDrivers(manifest)["harness-config"];
  return raw ? harnessConfigBinding.parse(raw) : undefined;
}
