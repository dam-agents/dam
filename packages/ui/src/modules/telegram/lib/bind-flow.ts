/** Pure helpers for the /telegram/bind page — node-testable, no DOM. */

export function readFlowIdFromSearch(search: string): string | null {
  const flow = new URLSearchParams(search).get("flow");
  return flow && flow.length > 0 ? flow : null;
}

/** Error the OAuth callback redirected with (?error=…), if any. */
export function readCallbackErrorFromSearch(search: string): string | null {
  return new URLSearchParams(search).get("error");
}

export interface BindErrorCopy {
  title: string;
  hint: string;
  /** Terminal errors hide the picker — only a fresh /login recovers. */
  terminal: boolean;
}

export function callbackErrorCopy(code: string): BindErrorCopy {
  switch (code) {
    case "denied":
      return {
        title: "Login was cancelled",
        hint: "Send /login in the Telegram chat to try again.",
        terminal: true,
      };
    case "expired":
      return {
        title: "This login link has expired",
        hint: "Send /login in the Telegram chat to get a fresh link.",
        terminal: true,
      };
    default:
      return {
        title: "Login failed",
        hint: "Send /login in the Telegram chat to try again.",
        terminal: true,
      };
  }
}

/** Maps a failed bind mutation's tRPC error code to page copy. */
export function bindErrorCopy(code: string | undefined): BindErrorCopy {
  switch (code) {
    case "BAD_REQUEST":
      return {
        title: "This link is invalid or has expired",
        hint: "Send /login in the Telegram chat to get a fresh link.",
        terminal: true,
      };
    case "CONFLICT":
      return {
        title: "This chat is already connected to another agent",
        hint: "Send /logout in the chat first, then /login again.",
        terminal: true,
      };
    case "NOT_FOUND":
      return {
        title: "That agent no longer exists",
        hint: "Pick a different agent.",
        terminal: false,
      };
    default:
      return {
        title: "Something went wrong",
        hint: "Try again — or send /login in the chat for a fresh link.",
        terminal: false,
      };
  }
}
