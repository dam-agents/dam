export function formatCores(milli: number): string {
  return String(Number((milli / 1000).toFixed(2)));
}

export function formatGi(bytes: number): string {
  const gi = bytes / 1024 ** 3;
  return Number.isInteger(gi) ? String(gi) : gi.toFixed(1);
}

export function formatMiAsMemory(mi: number): string {
  return mi % 1024 === 0 ? `${mi / 1024}Gi` : `${mi}Mi`;
}
