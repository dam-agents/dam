export type BrowserState = "starting" | "ready" | "failed";

export type ControlMessage =
  | { type: "url"; url: string }
  | { type: "preview_error"; message: string }
  | { type: "browser_state"; state: BrowserState; message: string | null };

export function parseControlMessage(raw: string): ControlMessage | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (m.type === "url" && typeof m.url === "string")
    return { type: "url", url: m.url };
  if (m.type === "preview_error" && typeof m.message === "string")
    return { type: "preview_error", message: m.message };
  if (
    m.type === "browser_state" &&
    (m.state === "starting" || m.state === "ready" || m.state === "failed")
  )
    return {
      type: "browser_state",
      state: m.state,
      message: typeof m.message === "string" ? m.message : null,
    };
  return null;
}

export function addressUrl(raw: string): string | null {
  const address = raw.trim();
  if (!address) return null;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(address)
    ? address
    : `http://${address}`;
}
