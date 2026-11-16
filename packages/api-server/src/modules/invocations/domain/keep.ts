// UNIT_BOUNDARY_DESCRIPTION: how long a kept target outlives its result: a day unless its driver names a time, never longer than an Environment may live, so a kept target is a sandbox of the driver's that is no harder to forget than an Environment.
export const DEFAULT_KEEP_MS = 24 * 60 * 60 * 1000;
export const MIN_KEEP_MS = 60 * 1000;

export function keepUntil(
  now: Date,
  keepForMs: number | undefined,
  maxMs: number,
): Date | { error: string } {
  const ms = keepForMs ?? DEFAULT_KEEP_MS;
  if (ms < MIN_KEEP_MS) return { error: "keepFor must be at least a minute" };
  if (ms > maxMs)
    return {
      error: `keepFor may be at most ${Math.floor(maxMs / 86_400_000)} days, as long as an Environment may live`,
    };
  return new Date(now.getTime() + ms);
}
