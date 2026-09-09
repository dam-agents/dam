export function parseVersion(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const v = Number.parseInt(raw, 10);
  return Number.isInteger(v) && v >= 1 ? v : undefined;
}
