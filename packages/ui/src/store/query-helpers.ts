import { emitToast } from "./toast-sink.js";

/**
 * Sentinel returned from `runAction` on failure. Distinct from `undefined` so
 * callers can safely use `runAction` with mutations that resolve to void.
 */
export const ACTION_FAILED: unique symbol = Symbol("platform:ACTION_FAILED");
export type ActionResult<T> = T | typeof ACTION_FAILED;

/**
 * Wrap a user-initiated action (button click, dialog submit). Any error surfaces
 * as a toast; returns ACTION_FAILED so callers can short-circuit.
 */
export async function runAction<T>(fn: () => Promise<T>, fallback: string): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (err: unknown) {
    const msg = err instanceof Error && err.message ? err.message : fallback;
    emitToast({ kind: "error", message: msg });
    return ACTION_FAILED;
  }
}

/**
 * Wrap a background query (polling, initial fetch). Silently swallows transient
 * failures — only surfaces a toast once the same `label` has failed `threshold`
 * times in a row, and only once per sustained outage (resets on first success).
 *
 * Threshold is approximate: if two calls with the same label fail in parallel,
 * the counter can advance by more than one per "tick". Acceptable for UX —
 * this is a "notify on sustained failure" signal, not a precise metric.
 *
 * Per-label tracker state is held in module-scope maps. To prevent unbounded
 * growth across a long-lived SPA session, call `resetQueryTracker(label)` when
 * the label's scope ends (e.g. when the associated instance is deselected).
 */
const DEFAULT_THRESHOLD = 3;
const failCounts = new Map<string, number>();
const notified = new Set<string>();

export async function runQuery<T>(
  label: string,
  fn: () => Promise<T>,
  opts: { fallback: string; threshold?: number },
): Promise<T | undefined> {
  try {
    const v = await fn();
    failCounts.delete(label);
    notified.delete(label);
    return v;
  } catch {
    const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
    const n = (failCounts.get(label) ?? 0) + 1;
    failCounts.set(label, n);
    if (n >= threshold && !notified.has(label)) {
      notified.add(label);
      emitToast({ kind: "warning", message: opts.fallback });
    }
    return undefined;
  }
}

/** Clear accumulated failure state for labels matching `prefix`. */
export function resetQueryTracker(prefix: string): void {
  for (const k of failCounts.keys()) if (k.startsWith(prefix)) failCounts.delete(k);
  for (const k of notified) if (k.startsWith(prefix)) notified.delete(k);
}
