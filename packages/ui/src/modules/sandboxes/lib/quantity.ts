/** Slider-unit parsing for Sizes coming back off specs and templates.
 *  Display seeding only — server-side stamping is the source of truth.
 *
 *  Sizes the UI itself wrote are always "<n>m" / "<n>Mi", but template YAML
 *  (and operator-edited specs) may carry any K8s quantity ("1.5Gi", "1G",
 *  "1024M"). Parse the practical grammar rather than a slider-shaped subset:
 *  a misparse here baselines the form to a fallback, and saving would then
 *  silently rewrite the sandbox's real size. */
export function parseCpuMilli(q: string | undefined): number | null {
  if (!q) return null;
  const m = q.trim().match(/^(\d+(?:\.\d+)?)(m)?$/);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? 1 : 1000);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// K8s binary (Ki/Mi/Gi/Ti) and decimal (k/M/G/T) suffixes; no suffix = bytes.
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

/** Slider units → the create call's `size` quantity strings. */
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
