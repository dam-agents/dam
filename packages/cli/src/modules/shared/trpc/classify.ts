import { err, ok, type Result } from "../../../result.js";
import type { AuthRequiredError, TransportError } from "../errors.js";
import {
  AuthRequiredAtTransportError,
  TermsStaleAtTransportError,
} from "./trpc-client.js";

export function classifyTrpcError(
  e: unknown,
): Result<never, TransportError | AuthRequiredError> {
  let cursor: unknown = e;
  for (let depth = 0; cursor && depth < 8; depth++) {
    if (cursor instanceof TermsStaleAtTransportError) throw cursor;
    if (cursor instanceof AuthRequiredAtTransportError)
      return err({ kind: "auth-required", reason: cursor.message });
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return err({
    kind: "transport",
    reason:
      e instanceof Error
        ? e.message
        : typeof e === "string"
          ? e
          : "unknown transport failure",
  });
}

export async function trpcCall<T>(
  fn: () => Promise<T>,
): Promise<Result<T, TransportError | AuthRequiredError>> {
  try {
    return ok(await fn());
  } catch (e) {
    return classifyTrpcError(e);
  }
}
