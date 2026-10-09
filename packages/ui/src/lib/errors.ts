export function getErrorMessage(e: unknown, fallback?: string): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === "string" && m) return zodIssuesText(m) ?? m;
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

function zodIssuesText(message: string): string | undefined {
  if (!message.startsWith("[")) return undefined;
  try {
    const issues: unknown = JSON.parse(message);
    if (!Array.isArray(issues) || issues.length === 0) return undefined;
    const lines = issues.map((issue: { message?: unknown }) =>
      typeof issue?.message === "string" ? issue.message : undefined,
    );
    return lines.every((l) => l !== undefined) ? lines.join("; ") : undefined;
  } catch {
    return undefined;
  }
}
