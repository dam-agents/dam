/**
 * The best human-readable message from an unknown throwable, covering the
 * shapes that actually reach the UI:
 *  - an `Error` / `DOMException` — has `.message`
 *  - the raw JSON-RPC error `{ code, message, data }` — has `.message`
 *  - a WebSocket `CloseEvent` with a `reason` — the reason is the message
 *  - a `CloseEvent` with no reason / a bare `onerror` `Event` — no usable
 *    message; only a generic "connection …" line describes it
 *
 * When there is no usable message, a caller-supplied `fallback` wins: it names
 * the operation that failed ("Delete failed", "Couldn't open <path>"), which
 * tells the user more than a generic transport line. Without a fallback we fall
 * back to that transport line, then `String(e)`.
 */
export function getErrorMessage(e: unknown, fallback?: string): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  if (e instanceof Error && e.message) return e.message;
  if (
    typeof CloseEvent !== "undefined" &&
    e instanceof CloseEvent &&
    e.reason
  ) {
    return e.reason;
  }
  // No usable message from here on — a supplied fallback beats the generic
  // transport description. `!== undefined` (not truthiness) so an intentional
  // empty-string fallback ("give me a real message or nothing") is honoured
  // rather than falling through to String(e).
  if (fallback !== undefined) return fallback;
  if (typeof CloseEvent !== "undefined" && e instanceof CloseEvent) {
    return `Connection closed (code ${e.code})`;
  }
  if (typeof Event !== "undefined" && e instanceof Event) {
    return "Connection error";
  }
  return String(e);
}
