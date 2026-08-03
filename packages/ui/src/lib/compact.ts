/** Object literal minus its `undefined` entries, so optional payload fields
 *  can be written as plain properties instead of conditional spreads. */
export function compact<T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as { [K in keyof T]: Exclude<T[K], undefined> };
}
