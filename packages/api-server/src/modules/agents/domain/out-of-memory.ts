export const OUT_OF_MEMORY_REASON = "OutOfMemory";

export type PodRestartState = {
  restarts: number;
  reason: string | undefined;
};

export function isNewOutOfMemoryRestart(
  previous: PodRestartState | undefined,
  next: PodRestartState,
): boolean {
  if (!previous) return false;
  if (next.reason !== OUT_OF_MEMORY_REASON || next.restarts === 0) return false;
  return next.restarts !== previous.restarts;
}
