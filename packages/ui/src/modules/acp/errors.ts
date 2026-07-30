/**
 * Error extraction and presentation for the ACP session surface. Kept free of
 * imports with browser side effects so node-environment unit tests (and any
 * non-DOM caller) can use it directly.
 */

/**
 * Read a human-readable message off any error shape we may see here. The
 * promise that `prompt`/`loadSession` returns can reject with:
 *  - an `Error` / `DOMException` — has `.message`
 *  - the raw JSON-RPC error `{ code, message, data }` — has `.message`
 *  - a WebSocket `CloseEvent` on connection drop — no message; use `code`/`reason`
 *  - a WebSocket `Event` from `onerror` — browsers omit useful details here
 *
 * The fallback `String(e)` on an Event yields `[object Event]`, which is what
 * users were seeing on disconnect.
 */
export function extractErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === "string" && m) {
      const details = jsonRpcErrorDetails(e);
      if (details && !m.includes(details)) {
        // "Internal error" is the JSON-RPC boilerplate for -32603 — the real
        // reason (e.g. the model backend's HTTP error) rides in data.details.
        return /^internal error\.?$/i.test(m.trim())
          ? details
          : `${m}: ${details}`;
      }
      return m;
    }
  }
  if (e instanceof Error) return e.message;
  if (typeof CloseEvent !== "undefined" && e instanceof CloseEvent) {
    return e.reason || `Connection closed (code ${e.code})`;
  }
  if (typeof Event !== "undefined" && e instanceof Event) {
    return "Connection error";
  }
  return String(e);
}

/** Pull the harness's detail string out of a JSON-RPC error's `data` slot.
 *  The ACP SDK ships it either as `data.details` (string) or as the whole
 *  `data` value when the harness threw a plain string. */
function jsonRpcErrorDetails(e: object): string | null {
  const data = (e as { data?: unknown }).data;
  if (typeof data === "string" && data) return data;
  if (data && typeof data === "object") {
    const details = (data as { details?: unknown }).details;
    if (typeof details === "string" && details) return details;
  }
  return null;
}

export interface SendErrorDescription {
  /** What to render as the failure reason. */
  message: string;
  /** Actionable next step for failure classes we recognize. */
  hint?: string;
}

const SEND_ERROR_HINTS: ReadonlyArray<[RegExp, string]> = [
  [
    /\b402\b|payment.required|insufficient.credits|credit balance|billing|quota exceeded|out of credits/i,
    "The model backend refused the request for billing reasons — the inference account is out of credits or over quota. Topping up or raising the quota on the provider account should restore sends.",
  ],
  [
    /\b401\b|authentication_error|unauthenticated|invalid (api|x-api).key|unauthorized/i,
    "The model backend rejected the credential. Check that the API/OAuth secret is correct and linked to this agent (Agents → select agent → Secrets).",
  ],
  [
    /\b429\b|rate.limit/i,
    "The model backend is rate-limiting requests. Wait a moment and retry.",
  ],
];

/**
 * Turn a raw send-failure message into what the error card renders. Known
 * upstream failure classes (billing, credentials, rate limits) get an
 * actionable hint; bare JSON-RPC "Internal error" — all the harness gave us —
 * gets replaced with wording that at least says where to look next.
 */
export function describeSendError(raw: string): SendErrorDescription {
  for (const [pattern, hint] of SEND_ERROR_HINTS) {
    if (pattern.test(raw)) return { message: raw, hint };
  }
  if (/^internal error\.?$/i.test(raw.trim())) {
    return {
      message: "The agent couldn't process this message.",
      hint: "The harness reported an internal error without details — the agent's session log usually has the underlying cause (often the model backend rejecting the request).",
    };
  }
  return { message: raw };
}

/**
 * Classify a resume-time failure so the inline error card can render the
 * right message and action. Prefers structured error fields (ACP JSON-RPC
 * `code`, tRPC `data.code`) over regexing the human-readable message — the
 * latter breaks the moment server wording changes.
 */
export function classifyResumeError(
  e: unknown,
): "not-found" | "connection" | "other" {
  if (e && typeof e === "object") {
    const anyE = e as { code?: unknown; data?: { code?: unknown } };
    if (anyE.code === -32002) return "not-found";
    if (anyE.data?.code === "NOT_FOUND") return "not-found";
    if (e instanceof DOMException) return "connection";
  }
  const msg = extractErrorMessage(e);
  if (/not\s*found/i.test(msg)) return "not-found";
  if (/refused|ECONN|WebSocket|network/i.test(msg)) return "connection";
  return "other";
}
