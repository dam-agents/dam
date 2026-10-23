const wholeOrOneDecimal = (value: number): string =>
  value.toFixed(1).replace(/\.0$/, "");

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${wholeOrOneDecimal(bytes / 1024 ** 3)} GiB`;
  if (bytes >= 1024 ** 2) return `${wholeOrOneDecimal(bytes / 1024 ** 2)} MiB`;
  if (bytes >= 1024) return `${wholeOrOneDecimal(bytes / 1024)} KiB`;
  return `${bytes} B`;
}

export function formatGi(bytes: number): string {
  return wholeOrOneDecimal(bytes / 1024 ** 3);
}
