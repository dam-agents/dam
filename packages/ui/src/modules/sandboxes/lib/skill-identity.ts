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
