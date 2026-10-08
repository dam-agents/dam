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
  return next.reason === OUT_OF_MEMORY_REASON && next.restarts > previous.restarts;
}
