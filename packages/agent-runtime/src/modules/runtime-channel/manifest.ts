import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { load as parseYaml } from "js-yaml";
import { z } from "zod";

/**
 * `runtime-manifest.yaml` — declared by each agent image at a known
 * path (ADR-052 §"Per-harness driver model"). Two top-level concerns:
 *
 *   1. `drivers` — map of Contribution kind → driver binding (impl
 *      name + impl-specific config). Each kind in here is what the
 *      agent advertises in `hello.capabilities.contributions`; the
 *      runtime channel derives the capability set from this map, no
 *      separate capability declaration needed.
 *
 *   2. `extensions.impls` — optional list of out-of-tree plugin
 *      modules to dynamic-import at boot. Loaded against the agent
 *      image's normal `node_modules` via the runtime channel's
 *      extension loader. See `infrastructure/extension-loader.ts`.
 *
 * Validated at boot — fail-fast on a malformed manifest blocks
 * startup rather than half-applying. The manifest schema is versioned
 * independently of the protocol version (ADR-052 §"Versioning").
 */

const driverBinding = z
  .object({
    impl: z.string().min(1),
  })
  .catchall(z.unknown());
export type DriverBinding = z.infer<typeof driverBinding>;

const extensionImpl = z.object({
  /** Stable id used in `drivers.<kind>.impl`. The plugin's own
   *  `plugin.name` must equal this. */
  name: z.string().min(1),
  /** ES module specifier resolved against the agent image's
   *  node_modules. Bare specifiers (`@scope/pkg`) and absolute paths
   *  both work; relative specifiers are not portable across agent
   *  images and should be avoided. */
  module: z.string().min(1),
  /** Export on the resolved module exposing the {@link PluginModule}
   *  shape — i.e. `{ pluginProtocolVersion, createPlugin }`. */
  export: z.string().min(1),
});
export type ExtensionImpl = z.infer<typeof extensionImpl>;

export const runtimeManifestSchema = z.object({
  manifestVersion: z.literal(1),

  drivers: z.record(z.string(), driverBinding),

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

/**
 * Load + validate the runtime-manifest. Throws ManifestLoadError on
 * any problem; the caller is expected to crash the agent-runtime
 * process. Cross-checks (impl name collisions, kind-with-no-registered-
 * plugin) live in the dispatcher / extension-loader, which have
 * registry visibility this layer lacks.
 */
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
