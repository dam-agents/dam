const SERIES = [
  "#1192e8",
  "#198038",
  "#ee538b",
  "#b28600",
  "#009d9a",
  "#a56eff",
  "#6929c4",
  "#005d5d",
  "#9f1853",
  "#002d9c",
] as const;

export const seriesColor = (index: number): string =>
  SERIES[index % SERIES.length]!;
