export function parseCpuMilli(q: string | undefined): number | null {
  if (!q) return null;
  const m = q.trim().match(/^(\d+(?:\.\d+)?)(m)?$/);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? 1 : 1000);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

const MEMORY_UNIT_BYTES: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
};

export function parseMemoryMi(q: string | undefined): number | null {
  if (!q) return null;
  const m = q.trim().match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|k|M|G|T)?$/);
  if (!m) return null;
  const bytes = Number(m[1]) * (m[2] ? MEMORY_UNIT_BYTES[m[2]] : 1);
  const mi = Math.round(bytes / 1024 ** 2);
  return Number.isFinite(mi) && mi > 0 ? mi : null;
}

export function sizeToQuantities(
  cpuMilli: number | null,
  memoryMi: number | null,
): { cpu?: string; memory?: string } | undefined {
  if (cpuMilli === null && memoryMi === null) return undefined;
  return {
    ...(cpuMilli !== null ? { cpu: `${cpuMilli}m` } : {}),
    ...(memoryMi !== null ? { memory: `${memoryMi}Mi` } : {}),
  };
}
