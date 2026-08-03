export const SKILL_SOURCE_ROOTS = [
  "skills",
  ".claude/skills",
  ".agents/skills",
] as const;

/** The one sanctioned image location for system skills that must NOT reach
 *  every sandbox: the first-boot seed only copies `/app/working-dir`, so
 *  kind-specific skills are staged here and copied onto the PVC by the
 *  platform post-create (e.g. the experiments authoring kit). Origin
 *  classification reads it as a pristine root alongside the seeded
 *  workspace — image-shipped skills anywhere else will misclassify as
 *  user-authored. Must match the COPY in the agent Dockerfiles. */
export const STAGED_SKILLS_DIR = "/usr/local/share/dam-skills";

export interface DedupeByNameResult<T> {
  kept: T[];
  dropped: T[];
}

export function dedupeByName<T extends { name: string }>(
  items: readonly T[],
): DedupeByNameResult<T> {
  const seen = new Set<string>();
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const item of items) {
    if (seen.has(item.name)) {
      dropped.push(item);
    } else {
      seen.add(item.name);
      kept.push(item);
    }
  }
  return { kept, dropped };
}
