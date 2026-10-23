export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollUntil<T>(
  read: () => Promise<T>,
  opts: {
    timeoutSeconds: number;
    intervalMs: number;
    until: (value: T) => boolean;
  },
): Promise<boolean> {
  const deadline = Date.now() + opts.timeoutSeconds * 1000;
  while (true) {
    if (opts.until(await read())) return true;
    if (Date.now() + opts.intervalMs >= deadline) return false;
    await sleep(opts.intervalMs);
  }
}
