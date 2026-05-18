export function parseTimeout(raw: string | undefined, defaultSeconds: number): number | null {
  if (raw === undefined) return defaultSeconds;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
