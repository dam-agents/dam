import { readFile } from "node:fs/promises";
import yaml from "js-yaml";
import { z } from "zod";

/** Per-image `runtime-manifest.yaml` declares which contribution kinds
 *  this agent's runtime supports beyond the built-ins and which signal
 *  actions it can handle. ADR-048: manifest overrides MUST name a kind
 *  not present in the built-in registry (no override) — enforcement
 *  lives in `composeRuntimeChannel`. */
const manifestSchema = z.object({
  /** Optional version identifier — purely informational. */
  version: z.string().optional(),
  /** Names of contribution kinds declared by this agent image. Each
   *  must have a matching driver registered by name through
   *  `extraDrivers` in code. The manifest is the declaration; the
   *  driver code is what does the work. */
  contributionKinds: z.array(z.string().min(1)).default([]),
  /** Signal action ids this image handles. Same shape. */
  signalActions: z.array(z.string().min(1)).default([]),
});

export type RuntimeManifest = z.infer<typeof manifestSchema>;

export async function loadManifestFromFile(
  path: string,
): Promise<RuntimeManifest | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const parsed = yaml.load(raw);
  const result = manifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `runtime-channel manifest at ${path} invalid: ${result.error.message}`,
    );
  }
  return result.data;
}
