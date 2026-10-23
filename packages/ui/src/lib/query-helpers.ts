import { getErrorMessage } from "./errors.js";
import { emitToast } from "./toast.js";

export const ACTION_FAILED: unique symbol = Symbol("humr:ACTION_FAILED");
export type ActionResult<T> = T | typeof ACTION_FAILED;

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
