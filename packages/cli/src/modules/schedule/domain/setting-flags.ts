/**
 * UNIT_BOUNDARY_DESCRIPTION: undefined when no `--setting` flag was given,
 * so an update leaves the stored settings alone.
 */
export function parseSettingFlags(
  flags: readonly string[],
): Record<string, string> | undefined {
  if (flags.length === 0) return undefined;
  const settings: Record<string, string> = {};
  for (const flag of flags) {
    const at = flag.indexOf("=");
    const id = at === -1 ? "" : flag.slice(0, at).trim();
    const value = at === -1 ? "" : flag.slice(at + 1).trim();
    if (!id || !value)
      throw new Error(`--setting takes id=value, got "${flag}"`);
    settings[id] = value;
  }
  return settings;
}
