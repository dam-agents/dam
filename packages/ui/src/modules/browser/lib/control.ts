export type BrowserState = "starting" | "ready" | "failed";

export interface PageState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export type ControlMessage =
  | ({ type: "page" } & PageState)
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
  if (
    m.type === "page" &&
    typeof m.url === "string" &&
    typeof m.title === "string" &&
    typeof m.loading === "boolean" &&
    typeof m.canGoBack === "boolean" &&
    typeof m.canGoForward === "boolean"
  )
    return {
      type: "page",
      url: m.url,
      title: m.title,
      loading: m.loading,
      canGoBack: m.canGoBack,
      canGoForward: m.canGoForward,
    };
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

const SEARCH_URL = "https://duckduckgo.com/?q=";

const looksLikeHost = (text: string) => {
  const host = text.split(/[/?#]/, 1)[0] ?? "";
  return (
    /^localhost(:\d+)?$/i.test(host) ||
    /^\[[0-9a-f:.]+\](:\d+)?$/i.test(host) ||
    /^[^\s:]+\.[^\s:.]+(:\d+)?$/.test(host) ||
    /^[^\s:]+:\d+$/.test(host)
  );
};

export function withScheme(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
}

export function addressUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text;
  if (!/\s/.test(text) && looksLikeHost(text)) return `http://${text}`;
  return `${SEARCH_URL}${encodeURIComponent(text)}`;
}
