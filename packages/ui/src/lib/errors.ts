/**
 * The best human-readable message from an unknown throwable, covering the
 * shapes that actually reach the UI:
 *  - an `Error` / `DOMException` — has `.message`
 *  - the raw JSON-RPC error `{ code, message, data }` — has `.message`
 *  - a WebSocket `CloseEvent` on connection drop — no message; use `code`/`reason`
 *  - a WebSocket `Event` from `onerror` — browsers omit useful details here
 *
 * Anything with no usable message falls back to `fallback` when given, else
 * `String(e)` (which is why an `Event` without the guard reads `[object Event]`).
 */
export function getErrorMessage(e: unknown, fallback?: string): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  if (e instanceof Error) return e.message;
  if (typeof CloseEvent !== "undefined" && e instanceof CloseEvent) {
    return e.reason || `Connection closed (code ${e.code})`;
  }
  if (typeof Event !== "undefined" && e instanceof Event) {
    return "Connection error";
  }
  return fallback ?? String(e);
}
