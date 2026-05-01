import { z } from "zod/v4";
import type { SkillSource } from "api-server-api";

const seedSchema = z.array(
  z.object({
    name: z.string().min(1).max(128),
    gitUrl: z.url(),
  }),
);

export interface SkillSourceSeed {
  id: string;
  name: string;
  gitUrl: string;
}

const SEED_ID_PREFIX = "skill-src-seed-";

/** kebab-case slug derived from a seed entry's name. Mirrors the previous
 *  helm template's id scheme so existing references in the wild keep
 *  resolving. Stable across api-server restarts as long as the name is
 *  unchanged. */
export function seedSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function seedSourceId(name: string): string {
  return `${SEED_ID_PREFIX}${seedSlug(name)}`;
}

/** Parse the SKILL_SOURCES_SEED env var into a stable, deduped list of system
 *  Skill Sources. Returns an empty list when the env var is unset or empty.
 *
 *  Throws on:
 *  - malformed JSON
 *  - shape mismatch (caught by Zod)
 *  - empty slug (a name like "??!?" slugs to "" and would collide with itself)
 *  - slug collisions across entries
 *
 *  These throws happen at api-server startup so a misconfigured chart fails
 *  fast with a clear stderr instead of producing a silent missing-source
 *  bug discovered at install time. */
export function parseSeedSources(raw: string | undefined): SkillSourceSeed[] {
  if (!raw || raw.trim() === "") return [];

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `SKILL_SOURCES_SEED is not valid JSON: ${(err as Error).message}`,
    );
  }

  const entries = seedSchema.parse(json);

  const seen = new Map<string, string>();
  return entries.map((entry) => {
    const slug = seedSlug(entry.name);
    if (slug === "") {
      throw new Error(
        `SKILL_SOURCES_SEED: name ${JSON.stringify(entry.name)} slugs to an empty id`,
      );
    }
    const prior = seen.get(slug);
    if (prior !== undefined) {
      throw new Error(
        `SKILL_SOURCES_SEED: names ${JSON.stringify(prior)} and ${JSON.stringify(entry.name)} both slug to ${JSON.stringify(slug)}`,
      );
    }
    seen.set(slug, entry.name);
    return { id: `${SEED_ID_PREFIX}${slug}`, name: entry.name, gitUrl: entry.gitUrl };
  });
}

/** Surface seeds as `SkillSource` views, tagged `system: true` so the UI's
 *  "Platform" badge and the protected-source delete check both fall out. */
export function seedToSkillSource(seed: SkillSourceSeed): SkillSource {
  return { id: seed.id, name: seed.name, gitUrl: seed.gitUrl, system: true };
}
