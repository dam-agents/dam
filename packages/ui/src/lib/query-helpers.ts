import { getErrorMessage } from "./errors.js";
import { emitToast } from "./toast.js";

/**
 * Sentinel returned from `runAction` on failure. Distinct from `undefined` so
 * callers can safely use `runAction` with mutations that resolve to void.
 */
export const ACTION_FAILED: unique symbol = Symbol("humr:ACTION_FAILED");
export type ActionResult<T> = T | typeof ACTION_FAILED;

/**
 * Wrap a user-initiated action (button click, dialog submit). Any error surfaces
 * as a toast; returns ACTION_FAILED so callers can short-circuit.
 */
export async function runAction<T>(
  fn: () => Promise<T>,
  fallback: string,
): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (err: unknown) {
    emitToast({ kind: "error", message: getErrorMessage(err, fallback) });
    return ACTION_FAILED;
  }
}
