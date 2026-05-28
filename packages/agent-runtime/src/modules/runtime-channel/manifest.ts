import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { load as parseYaml } from "js-yaml";
import { z } from "zod";

const driverBinding = z
  .object({
    impl: z.string().min(1),
  })
  .catchall(z.unknown());
export type DriverBinding = z.infer<typeof driverBinding>;

const extensionImpl = z.object({
  name: z.string().min(1),
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
