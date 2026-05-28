/**
 * Retry `fn` while `shouldRetry(err)` returns true. Waits `backoffMs` with
 * ±10% jitter between attempts. The 10ms default is sized for K8s
 * optimistic-concurrency contention (see retry.DefaultRetry in client-go).
 */
export async function retry<T>(
  fn: () => Promise<T>,
  shouldRetry: (err: unknown) => boolean,
  attempts = 5,
  backoffMs = 10,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!shouldRetry(err)) throw err;
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) =>
          setTimeout(r, backoffMs * (0.9 + Math.random() * 0.2)),
        );
      }
    }
  }
  throw new Error(
    `retry(${fn.name || "?"}): failed after ${attempts} attempts`,
    { cause: lastErr },
  );
}
