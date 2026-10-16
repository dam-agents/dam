export interface SkillIdentity {
  source: string;
  name: string;
  path?: string;
}

function canonicalPath(path: string | null | undefined): string | undefined {
  const dir = path?.split("/").filter(Boolean).join("/");
  return dir || undefined;
}

export function sameSourcePath(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return canonicalPath(a) === canonicalPath(b);
}

export function withSourcePath(skill: { path?: string }): { path?: string } {
  const path = canonicalPath(skill.path);
  return path === undefined ? {} : { path };
}

export function selectionKey(skill: SkillIdentity): string {
  return `${skill.source}::${canonicalPath(skill.path) ?? ""}::${skill.name}`;
}

export function pickSetSource<S extends { gitUrl: string; path?: string }>(
  sources: readonly S[],
  entry: SkillIdentity,
): S | null {
  const sameRepo = sources.filter((s) => s.gitUrl === entry.source);
  const wanted = canonicalPath(entry.path);
  if (wanted !== undefined) {
    return sameRepo.find((s) => canonicalPath(s.path) === wanted) ?? null;
  }
  const pathless = sameRepo.find((s) => canonicalPath(s.path) === undefined);
  if (pathless) return pathless;
  return sameRepo.length === 1 ? sameRepo[0] : null;
}
