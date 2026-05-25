import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { load as parseYaml } from "js-yaml";
import { z } from "zod";

/**
 * `runtime-manifest.yaml` — declared by each agent image at a known path.
 * Tells the runtime channel which impl handles each Contribution kind, with
 * what config; and which Contribution + Event kinds the agent advertises in
 * `hello`. See ADR-052 §"Per-harness driver model".
 *
 * Validated at boot — fail-fast on a malformed manifest blocks startup
 * rather than half-applying. The schema is versioned independently of the
 * runtime channel's protocol version (ADR-052 §"Versioning").
 */

/**
 * Flat-shape binding so a manifest entry validates uniformly across impls.
 * Per-impl shape is enforced by the dispatcher (the impl knows which fields
 * it needs).
 */
const driverBinding = z
  .object({
    impl: z.string().min(1),
    // File impl fields (used by `file` kind directly via the contribution,
    // and by `mcp-entry` / similar via the binding-level config).
    path: z.string().optional(),
    format: z.enum(["yaml", "json", "text", "ini"]).optional(),
    mergeMode: z
      .enum([
        "overwrite",
        "section-marker",
        "key-targeted",
        "yaml-fill-if-missing",
      ])
      .optional(),
    keyPath: z.string().optional(),
    // Skill-install impl field.
    paths: z.array(z.string()).optional(),
  })
  .catchall(z.unknown());
export type DriverBinding = z.infer<typeof driverBinding>;

const extensionImpl = z.object({
  name: z.string().min(1),
  // ES module loaded via dynamic import at boot. `module` is an absolute
  // path inside the agent image; `export` names the function on that module.
  module: z.string().min(1),
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

  capabilities: z.object({
    contributions: z.array(z.string()),
    events: z.array(z.string()),
  }),
});
export type RuntimeManifest = z.infer<typeof runtimeManifestSchema>;

export class ManifestLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestLoadError";
  }
}

const BUILTIN_IMPL_NAMES = new Set(["file", "skill-install"]);

/**
 * Load + validate the runtime-manifest. Throws ManifestLoadError on any
 * problem; caller is expected to crash the agent-runtime process.
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

  // Custom impl names may not collide with built-ins (ADR-052).
  const customNames = new Set(
    parsed.data.extensions?.impls.map((i) => i.name) ?? [],
  );
  for (const name of customNames) {
    if (BUILTIN_IMPL_NAMES.has(name)) {
      throw new ManifestLoadError(
        `extension impl "${name}" collides with a built-in impl of the same name`,
      );
    }
  }

  // Every driver binding's impl must be either built-in or declared in
  // extensions.impls — fail loud if not.
  for (const [kind, binding] of Object.entries(parsed.data.drivers)) {
    if (
      !BUILTIN_IMPL_NAMES.has(binding.impl) &&
      !customNames.has(binding.impl)
    ) {
      throw new ManifestLoadError(
        `driver binding for kind "${kind}" references unknown impl "${binding.impl}" — declare it under extensions.impls`,
      );
    }
  }

  return parsed.data;
}
