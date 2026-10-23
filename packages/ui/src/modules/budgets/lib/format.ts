export function formatCores(milli: number): string {
  return String(Number((milli / 1000).toFixed(2)));
}
