// Carbon's data-vis categorical palette, assigned by row position — a colour
// identifies a row within one chart and carries no meaning of its own, so never
// use these for status.
//
// Ordered by contrast against the bar's track in *both* themes: the track is
// `bg-muted`, near-white in light and #262626 in dark, and Carbon's palette is
// tuned for a white background. The first six clear 3:1 either way; the darker
// four sit last because they lose the dark track (#002d9c reaches only 1.3:1),
// so a chart has to run past six rows before any bar is hard to see.
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
