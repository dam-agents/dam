export const PERMISSION_LEVELS = ["read", "write", "admin"] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export function levelsUpTo(granted: string): PermissionLevel[] {
  const ceiling = PERMISSION_LEVELS.indexOf(granted as PermissionLevel);
  if (ceiling < 0) return [];
  return PERMISSION_LEVELS.slice(0, ceiling + 1);
}

function split(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function readPermissions(raw: string): Record<string, PermissionLevel> {
  const out: Record<string, PermissionLevel> = {};
  for (const entry of split(raw)) {
    const sep = entry.indexOf(":");
    if (sep < 1) continue;
    const name = entry.slice(0, sep);
    const level = entry.slice(sep + 1).toLowerCase();
    if ((PERMISSION_LEVELS as readonly string[]).includes(level)) {
      out[name] = level as PermissionLevel;
    }
  }
  return out;
}

export function writePermissions(
  selection: Record<string, PermissionLevel>,
): string {
  return Object.keys(selection)
    .sort()
    .map((name) => `${name}:${selection[name]}`)
    .join(" ");
}

export function readRepositoryIds(raw: string): number[] {
  return split(raw)
    .filter((s) => /^\d+$/.test(s))
    .map(Number);
}

export function writeRepositoryIds(ids: readonly number[]): string {
  return [...ids].sort((a, b) => a - b).join(" ");
}

export function canProbe(
  fields: Record<string, string>,
  hostRequired = false,
): boolean {
  const needed = ["appId", "installationId", "privateKey"];
  if (hostRequired) needed.push("host");
  return needed.every((k) => (fields[k] ?? "").trim().length > 0);
}
