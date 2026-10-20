export const STRIP_W = 60;
export const STRIP_WIDE_W = 224;
export const STRIP_SNAP_PX = 12;

export function stripWidth(wide: boolean): number {
  return wide ? STRIP_WIDE_W : STRIP_W;
}

export function stripTravel(
  travel: number,
  delta: number,
  wide: boolean,
): { travel: number; flip: boolean } {
  const next = wide ? Math.min(0, travel + delta) : Math.max(0, travel + delta);
  return Math.abs(next) < STRIP_SNAP_PX
    ? { travel: next, flip: false }
    : { travel: 0, flip: true };
}
