/** Translation between the picker's selection and the two all-string form
 *  fields the server already parses. Keeping the form fields as the single
 *  source of truth means the picker holds no duplicate copy of the selection —
 *  it renders from these, and writes back through them.
 */

/** Levels a permission can be narrowed to, weakest first. `off` is not a level
 *  GitHub knows; it means "leave this permission out of the request". */
export const PERMISSION_LEVELS = ["read", "write", "admin"] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

/** Levels selectable for a permission the installation holds at `granted`.
 *  GitHub refuses anything above the installation, so a read-only grant offers
 *  read alone. */
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

/** Reads the permissions field into a name → level map. Unparseable entries are
 *  skipped rather than thrown: the field may hold half-typed text from before
 *  the user discovered the installation. */
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

/** Serializes back to the `name:level` form. Sorted so toggling a permission
 *  twice returns the field to its previous text rather than reordering it. */
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

/** Whether the inputs the probe needs are all filled. It reads as the app
 *  itself, so it cannot run until the key is present; a GitHub Enterprise
 *  template additionally has no REST base to read from without its host. */
export function canProbe(
  fields: Record<string, string>,
  hostRequired = false,
): boolean {
  const needed = ["appId", "installationId", "privateKey"];
  if (hostRequired) needed.push("host");
  return needed.every((k) => (fields[k] ?? "").trim().length > 0);
}
