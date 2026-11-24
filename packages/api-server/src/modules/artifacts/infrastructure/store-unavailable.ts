import { isUnreachable } from "../../../core/retry-unreachable.js";

const UNAVAILABLE_NAMES = new Set([
  "ServiceUnavailable",
  "SlowDown",
  "RequestTimeout",
  "InternalError",
]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: Says whether an object-store call failed because
 * the store is not serving now, so the same call can succeed later: the
 * connection failed (`isUnreachable`), or the store answered a 5xx or an S3
 * error that means "try again" (`ServiceUnavailable`, `SlowDown`,
 * `RequestTimeout`, `InternalError`). A store that starts behind a proxy
 * answers 502 or 503 before it listens. Any other answer, such as refused
 * credentials, is not one.
 */
export function isStoreUnavailable(err: unknown): boolean {
  if (isUnreachable(err)) return true;
  if (err === null || typeof err !== "object") return false;
  const { name, $metadata } = err as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  if (typeof name === "string" && UNAVAILABLE_NAMES.has(name)) return true;
  const status = $metadata?.httpStatusCode;
  return typeof status === "number" && status >= 500 && status <= 599;
}
