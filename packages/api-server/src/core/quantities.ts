export function parseCpuMilli(q: string | undefined): number {
  if (!q) return 0;
  const s = q.trim();
  const n = s.endsWith("m") ? Number(s.slice(0, -1)) : Number(s) * 1000;
  return Number.isFinite(n) ? Math.round(n) : 0;
}

const MEMORY_UNITS: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
};

export function parseMemoryBytes(q: string | undefined): number {
  if (!q) return 0;
  const m = q.trim().match(/^(\d+(?:\.\d+)?)([A-Za-z]+)?$/);
  if (!m) return 0;
  const factor = m[2] ? (MEMORY_UNITS[m[2]] ?? 0) : 1;
  return Math.round(Number(m[1]) * factor);
}
