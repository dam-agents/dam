// Carbon's data-vis categorical palette. Mid-tones, so one set works on both
// light and dark surfaces rather than needing a per-theme token each. Assigned
// by row position, so a colour identifies a row within one chart and carries no
// meaning of its own — never use these for status.
const SERIES = [
  "#1192e8",
  "#6929c4",
  "#005d5d",
  "#9f1853",
  "#198038",
  "#002d9c",
  "#ee538b",
  "#b28600",
  "#009d9a",
  "#a56eff",
] as const;

export const seriesColor = (index: number): string =>
  SERIES[index % SERIES.length]!;
