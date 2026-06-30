export const SKILL_SOURCE_ROOTS = [
  "skills",
  ".claude/skills",
  ".agents/skills",
] as const;

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
