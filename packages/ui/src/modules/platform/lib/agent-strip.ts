export const STRIP_W = 60;
export const STRIP_WIDE_W = 224;
export const STRIP_SNAP_PX = 12;

export function stripWidth(wide: boolean): number {
  return wide ? STRIP_WIDE_W : STRIP_W;
}
