// Pure materialization of the effective hibernation timeout (minutes; 0 = never,
// null = inherit the chart default) from the live keep-awake pins.

// The most-awake live pin wins — a never-pin (value 0/omitted) wins outright,
// otherwise the largest minute value. With no pins, the operator baseline governs.
export function currentFromPins(
  pins: readonly { value?: number }[],
  baseline: number | null,
): number | null {
  if (pins.length === 0) return baseline;
  let best = -1;
  for (const p of pins) {
    const v = p.value ?? 0;
    if (v <= 0) return 0;
    if (v > best) best = v;
  }
  return best;
}
