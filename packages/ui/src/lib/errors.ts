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
  if (fallback !== undefined) return fallback;
  if (typeof CloseEvent !== "undefined" && e instanceof CloseEvent) {
    return `Connection closed (code ${e.code})`;
  }
  if (typeof Event !== "undefined" && e instanceof Event) {
    return "Connection error";
  }
  return String(e);
}
