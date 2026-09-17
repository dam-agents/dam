import { z } from "zod/v4";

import { parseGithubRepoUrl } from "./catalog-source.js";

const seedSchema = z.array(
  z
    .object({
      name: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes"),
      url: z.url().optional(),
      path: z.string().min(1).optional(),
      ref: z.string().min(1).optional(),
      dir: z.string().min(1).optional(),
    })
    .refine((c) => (c.url ? 1 : 0) + (c.path ? 1 : 0) === 1, {
      message: "a catalog names exactly one of url or path",
    }),
);

export interface CatalogSeed {
  name: string;
  locator: string;
  kind: "url" | "path";
  ref?: string;
  dir?: string;
}

export function parseCatalogSeeds(raw: string | undefined): CatalogSeed[] {
  if (!raw || raw.trim() === "") return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `STARTER_KITS_CATALOGS is not valid JSON: ${(err as Error).message}`,
    );
  }
  const parsed = seedSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `STARTER_KITS_CATALOGS is invalid: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  const seen = new Set<string>();
  for (const c of parsed.data) {
    if (seen.has(c.name))
      throw new Error(`STARTER_KITS_CATALOGS names catalog "${c.name}" twice`);
    seen.add(c.name);
  }
  for (const c of parsed.data) {
    if (c.url && !parseGithubRepoUrl(c.url))
      throw new Error(
        `STARTER_KITS_CATALOGS catalog "${c.name}" names a url this reader cannot serve: ${c.url}. ` +
          `It must be a plain https://github.com/<owner>/<repo> URL — write a version as "ref" and a subdirectory as "dir", never inside the url.`,
      );
  }
  return parsed.data.map((c) => ({
    name: c.name,
    locator: (c.url ?? c.path)!,
    kind: c.url ? ("url" as const) : ("path" as const),
    ...(c.ref ? { ref: c.ref } : {}),
    ...(c.dir ? { dir: c.dir } : {}),
  }));
}
